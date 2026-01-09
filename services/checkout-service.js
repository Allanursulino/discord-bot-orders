const db = require("../database");
const { v4: uuidv4 } = require('uuid');
const productService = require('./product-service');
const paymentService = require('./payment-service');
const couponService = require('./coupon-service');
const { formatPrice } = require('../@shared');

class CheckoutService {
    // Criar novo checkout
    createCheckout(userId, productId, quantity = 1, variantId = null) {
        const product = productService.getProduct(productId);
        if (!product) return null;

        // Verificar variante
        let unitPrice = product.price;
        let selectedVariant = null;

        if (product.variants && product.variants.length > 0) {
            if (!variantId) return null;
            selectedVariant = product.variants.find(v => v.id === variantId);
            if (!selectedVariant) return null;
            unitPrice = selectedVariant.price;
        }

        // Verificar estoque
        if (!productService.checkStock(productId, quantity, variantId)) {
            return null;
        }

        const checkoutId = uuidv4();
        const checkout = {
            id: checkoutId,
            userId: userId,
            productId: productId,
            variantId: variantId,
            quantity: quantity,
            unitPrice: unitPrice,
            total: unitPrice * quantity,
            status: 'DRAFT', // DRAFT -> PENDING -> APPROVED -> COMPLETED
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            coupon: null,
            payment: null,
            currency: product.currency || 'BRL'
        };

        db.set(`checkout:${checkoutId}`, checkout);
        return checkout;
    }

    // Obter checkout
    getCheckout(checkoutId) {
        return db.get(`checkout:${checkoutId}`);
    }

    // Obter todos os checkouts
    getAllCheckouts() {
        const all = db.all();
        return all
            .filter(entry => entry.ID.startsWith('checkout:'))
            .map(entry => entry.data);
    }

    // Atualizar quantidade
    updateQuantity(checkoutId, quantity) {
        const checkout = this.getCheckout(checkoutId);
        if (!checkout) return null;

        if (!productService.checkStock(checkout.productId, quantity, checkout.variantId)) {
            return null;
        }

        checkout.quantity = quantity;
        checkout.total = checkout.unitPrice * quantity;
        
        // Recalcular com cupom se existir
        if (checkout.coupon) {
            this.recalculateWithCoupon(checkout);
        }

        checkout.updatedAt = new Date().toISOString();
        db.set(`checkout:${checkoutId}`, checkout);
        return checkout;
    }

    // Recalcular total com cupom
    recalculateWithCoupon(checkout) {
        if (!checkout.coupon) return checkout;

        const product = productService.getProduct(checkout.productId);
        if (!product) return checkout;

        const baseTotal = checkout.unitPrice * checkout.quantity;
        
        if (checkout.coupon.type === 'PERCENTAGE') {
            const discount = baseTotal * (checkout.coupon.amount / 100);
            checkout.total = Math.max(baseTotal - discount, 0);
            checkout.coupon.discount = discount;
        } else if (checkout.coupon.type === 'FIXED') {
            checkout.total = Math.max(baseTotal - checkout.coupon.amount, 0);
            checkout.coupon.discount = checkout.coupon.amount;
        }

        return checkout;
    }

    // Aplicar cupom
    applyCoupon(checkoutId, couponCode, userId, productId, region) {
        const checkout = this.getCheckout(checkoutId);
        if (!checkout) return { success: false, error: 'Checkout não encontrado' };

        const product = productService.getProduct(productId);
        if (!product) return { success: false, error: 'Produto não encontrado' };

        // Validar cupom
        const validation = couponService.validateCoupon(
            couponCode,
            userId,
            productId,
            region,
            checkout.total
        );

        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Aplicar desconto
        checkout.coupon = {
            code: validation.coupon.code,
            type: validation.coupon.type,
            amount: validation.coupon.amount,
            discount: validation.discount
        };

        checkout.total = Math.max(checkout.unitPrice * checkout.quantity - validation.discount, 0);
        checkout.updatedAt = new Date().toISOString();
        
        db.set(`checkout:${checkoutId}`, checkout);

        // Marcar cupom como usado
        couponService.useCoupon(couponCode);

        return { 
            success: true, 
            checkout: checkout,
            discount: validation.discount,
            message: `Cupom ${couponCode} aplicado com sucesso!`
        };
    }

    // Remover cupom
    removeCoupon(checkoutId) {
        const checkout = this.getCheckout(checkoutId);
        if (!checkout || !checkout.coupon) return null;

        checkout.total = checkout.unitPrice * checkout.quantity;
        checkout.coupon = null;
        checkout.updatedAt = new Date().toISOString();
        
        db.set(`checkout:${checkoutId}`, checkout);
        return checkout;
    }

    // Iniciar pagamento
    async startPayment(checkoutId, paymentMethod) {
        const checkout = this.getCheckout(checkoutId);
        if (!checkout) return null;

        const product = productService.getProduct(checkout.productId);
        if (!product) return null;

        let paymentResult;

        if (paymentMethod === 'pix') {
            // PIX com SumUp
            paymentResult = await paymentService.generatePixQRCode(
                checkout.total,
                `Compra: ${product.title}`,
                checkoutId
            );
        } else {
            // Stripe (cartão/boleto)
            paymentResult = await paymentService.createStripePaymentLink(
                checkout.total,
                product.title,
                {
                    checkout_id: checkoutId,
                    user_id: checkout.userId,
                    product_id: product.id,
                    product_name: product.title,
                    region: product.region
                }
            );
        }

        checkout.payment = {
            method: paymentMethod,
            provider: paymentMethod === 'pix' ? 'sumup' : 'stripe',
            data: paymentResult,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        checkout.status = 'PENDING';
        checkout.updatedAt = new Date().toISOString();
        db.set(`checkout:${checkoutId}`, checkout);

        return {
            checkout: checkout,
            payment: paymentResult
        };
    }

    // Verificar status do pagamento
    async checkPaymentStatus(checkoutId) {
        const checkout = this.getCheckout(checkoutId);
        if (!checkout || !checkout.payment) return null;

        let status;
        
        if (checkout.payment.provider === 'sumup') {
            status = await paymentService.checkPixPayment(checkout.payment.data.checkout_id);
        } else {
            status = await paymentService.checkStripePayment(checkout.payment.data.payment_intent_id);
        }

        if (status.status === 'PAID' || status.status === 'succeeded') {
            checkout.status = 'APPROVED';
            checkout.payment.status = 'paid';
            checkout.payment.paidAt = new Date().toISOString();
            
            // Reduzir estoque
            productService.reduceStock(
                checkout.productId, 
                checkout.quantity, 
                checkout.variantId
            );
        }

        checkout.updatedAt = new Date().toISOString();
        db.set(`checkout:${checkoutId}`, checkout);

        return checkout;
    }

    // Cancelar checkout
    cancelCheckout(checkoutId) {
        const checkout = this.getCheckout(checkoutId);
        if (!checkout) return false;

        checkout.status = 'CANCELLED';
        checkout.updatedAt = new Date().toISOString();
        db.set(`checkout:${checkoutId}`, checkout);
        return true;
    }

    // Atualizar status do checkout
    updateCheckoutStatus(checkoutId, checkoutData) {
        db.set(`checkout:${checkoutId}`, checkoutData);
        return checkoutData;
    }

    // Obter checkouts por usuário
    getUserCheckouts(userId, status = null) {
        const all = this.getAllCheckouts();
        return all.filter(checkout => {
            if (checkout.userId !== userId) return false;
            if (status && checkout.status !== status) return false;
            return true;
        });
    }

    // Obter checkouts por status
    getCheckoutsByStatus(status) {
        const all = this.getAllCheckouts();
        return all.filter(checkout => checkout.status === status);
    }

    // Limpar checkouts antigos
    cleanupOldCheckouts(maxAgeHours = 24) {
        const all = this.getAllCheckouts();
        const now = new Date();
        let cleaned = 0;

        all.forEach(checkout => {
            const createdAt = new Date(checkout.createdAt);
            const hoursDiff = (now - createdAt) / (1000 * 60 * 60);
            
            if (hoursDiff > maxAgeHours && 
                (checkout.status === 'CANCELLED' || checkout.status === 'COMPLETED')) {
                db.delete(`checkout:${checkout.id}`);
                cleaned++;
            }
        });

        return cleaned;
    }
}

module.exports = new CheckoutService();