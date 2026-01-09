const db = require("../database");
const { v4: uuidv4 } = require('uuid');

class CouponService {
    // Criar cupom
    createCoupon(couponData) {
        const couponId = uuidv4();
        const coupon = {
            id: couponId,
            code: couponData.code.toUpperCase(),
            type: couponData.type || 'PERCENTAGE', // PERCENTAGE ou FIXED
            amount: couponData.amount,
            max_uses: couponData.max_uses || null,
            used_count: 0,
            min_purchase: couponData.min_purchase || 0,
            valid_from: couponData.valid_from || new Date().toISOString(),
            valid_until: couponData.valid_until || null,
            products: couponData.products || [], // Array de product IDs (vazio = todos)
            regions: couponData.regions || [], // Array de regiões (vazio = todas)
            created_by: couponData.created_by,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        db.set(`coupon:${coupon.code}`, coupon);
        return coupon;
    }

    // Obter cupom pelo código
    getCoupon(code) {
        return db.get(`coupon:${code.toUpperCase()}`);
    }

    // Listar todos os cupons
    getAllCoupons() {
        const all = db.all();
        return all
            .filter(entry => entry.ID.startsWith('coupon:'))
            .map(entry => entry.data);
    }

    // Verificar se cupom é válido
    validateCoupon(code, userId, productId, region, purchaseAmount) {
        const coupon = this.getCoupon(code);
        if (!coupon) {
            return { valid: false, error: 'Cupom não encontrado' };
        }

        // Verificar validade
        const now = new Date();
        const validFrom = new Date(coupon.valid_from);
        if (now < validFrom) {
            return { valid: false, error: 'Cupom ainda não está válido' };
        }

        if (coupon.valid_until) {
            const validUntil = new Date(coupon.valid_until);
            if (now > validUntil) {
                return { valid: false, error: 'Cupom expirado' };
            }
        }

        // Verificar uso máximo
        if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
            return { valid: false, error: 'Cupom já foi usado o máximo de vezes' };
        }

        // Verificar valor mínimo
        if (purchaseAmount < coupon.min_purchase) {
            return { 
                valid: false, 
                error: `Valor mínimo para este cupom: ${coupon.min_purchase}` 
            };
        }

        // Verificar produtos específicos
        if (coupon.products.length > 0 && !coupon.products.includes(productId)) {
            return { valid: false, error: 'Cupom não válido para este produto' };
        }

        // Verificar regiões
        if (coupon.regions.length > 0 && !coupon.regions.includes(region)) {
            return { valid: false, error: 'Cupom não válido para esta região' };
        }

        // Cupom válido
        return { 
            valid: true, 
            coupon: coupon,
            discount: this.calculateDiscount(coupon, purchaseAmount)
        };
    }

    // Calcular desconto
    calculateDiscount(coupon, amount) {
        if (coupon.type === 'PERCENTAGE') {
            const discount = amount * (coupon.amount / 100);
            return Math.min(discount, coupon.max_discount || Infinity);
        } else if (coupon.type === 'FIXED') {
            return Math.min(coupon.amount, amount);
        }
        return 0;
    }

    // Usar cupom (incrementar contador)
    useCoupon(code) {
        const coupon = this.getCoupon(code);
        if (!coupon) return false;

        coupon.used_count += 1;
        coupon.updated_at = new Date().toISOString();
        db.set(`coupon:${coupon.code}`, coupon);
        return true;
    }

    // Atualizar cupom
    updateCoupon(code, updates) {
        const coupon = this.getCoupon(code);
        if (!coupon) return null;

        const updatedCoupon = {
            ...coupon,
            ...updates,
            updated_at: new Date().toISOString()
        };

        db.set(`coupon:${code}`, updatedCoupon);
        return updatedCoupon;
    }

    // Deletar cupom
    deleteCoupon(code) {
        return db.delete(`coupon:${code.toUpperCase()}`);
    }

    // Verificar se código já existe
    codeExists(code) {
        return this.getCoupon(code) !== undefined;
    }

    // Gerar código único
    generateUniqueCode(length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code;
        
        do {
            code = '';
            for (let i = 0; i < length; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        } while (this.codeExists(code));
        
        return code;
    }

    // Obter estatísticas
    getStatistics() {
        const coupons = this.getAllCoupons();
        const now = new Date();
        
        return {
            total: coupons.length,
            active: coupons.filter(c => {
                if (c.valid_until) {
                    return new Date(c.valid_until) > now;
                }
                return true;
            }).length,
            expired: coupons.filter(c => {
                if (c.valid_until) {
                    return new Date(c.valid_until) <= now;
                }
                return false;
            }).length,
            total_uses: coupons.reduce((sum, c) => sum + c.used_count, 0),
            percentage_coupons: coupons.filter(c => c.type === 'PERCENTAGE').length,
            fixed_coupons: coupons.filter(c => c.type === 'FIXED').length
        };
    }
}

module.exports = new CouponService();