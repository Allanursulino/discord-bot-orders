const axios = require('axios');
const qrcode = require('qrcode');
const Stripe = require('stripe');
const config = require('../config.json');
const logger = require('../utils/logger');

class PaymentService {
    constructor() {
        this.stripe = new Stripe(config.payment.stripe.secret_key);
        this.sumupConfig = config.payment.sumup;
        this.stripeConfig = config.payment.stripe;
        this.emojis = config.emojis;
    }

    // SumUp - Gerar QR Code PIX
    async generatePixQRCode(amount, description, checkoutId) {
        try {
            logger.info(`Gerando QR Code PIX para checkout ${checkoutId}`, { amount, description });
            
            // Autenticação no SumUp
            const authResponse = await axios.post('https://api.sumup.com/token', {
                grant_type: 'client_credentials',
                client_id: this.sumupConfig.client_id,
                client_secret: this.sumupConfig.client_secret,
                scope: 'payments'
            }, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const accessToken = authResponse.data.access_token;
            logger.info('Autenticação SumUp realizada');

            // Criar checkout PIX
            const checkoutResponse = await axios.post('https://api.sumup.com/v0.1/checkouts', {
                checkout_reference: checkoutId,
                amount: parseFloat(amount).toFixed(2),
                currency: 'BRL',
                merchant_code: this.sumupConfig.merchant_code,
                description: description.slice(0, 255),
                payment_type: 'pix',
                return_url: 'https://discord.com/channels/@me'
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const sumupCheckoutId = checkoutResponse.data.id;
            logger.info(`Checkout SumUp criado: ${sumupCheckoutId}`);

            // Gerar QR Code
            const qrCodeData = checkoutResponse.data.pix_data.qr_code;
            const qrCodeImage = await qrcode.toDataURL(qrCodeData);

            logger.pagamento(checkoutId, 'PIX_GERADO', 'SumUp');

            return {
                checkout_id: sumupCheckoutId,
                qr_code: qrCodeImage,
                pix_code: checkoutResponse.data.pix_data.br_code,
                amount: amount,
                expires_at: checkoutResponse.data.valid_until,
                raw_response: checkoutResponse.data
            };
        } catch (error) {
            logger.erro('GERAR_PIX', error, checkoutId);
            console.error('SumUp API Error:', error.response?.data || error.message);
            throw new Error(`Erro ao gerar PIX: ${error.response?.data?.message || error.message}`);
        }
    }

    // Verificar status do pagamento PIX
    async checkPixPayment(checkoutId) {
        try {
            const authResponse = await axios.post('https://api.sumup.com/token', {
                grant_type: 'client_credentials',
                client_id: this.sumupConfig.client_id,
                client_secret: this.sumupConfig.client_secret
            });

            const accessToken = authResponse.data.access_token;

            const response = await axios.get(`https://api.sumup.com/v0.1/checkouts/${checkoutId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            });

            const status = response.data.status;
            
            if (status === 'PAID') {
                logger.pagamento(checkoutId, 'PIX_PAGO', 'SumUp');
            }

            return {
                status: status,
                transaction_id: response.data.transaction_id,
                paid_at: response.data.paid_at,
                amount: response.data.amount,
                currency: response.data.currency
            };
        } catch (error) {
            logger.erro('VERIFICAR_PIX', error, checkoutId);
            throw error;
        }
    }

    // Stripe - Criar link de pagamento
    async createStripePaymentLink(amount, description, metadata = {}) {
        try {
            logger.info(`Criando link Stripe: ${description}`, { amount, metadata });
            
            const paymentLink = await this.stripe.paymentLinks.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'brl',
                            product_data: {
                                name: description.slice(0, 300),
                                metadata: metadata
                            },
                            unit_amount: Math.round(amount * 100), // Centavos
                        },
                        quantity: 1,
                    },
                ],
                metadata: metadata,
                after_completion: {
                    type: 'redirect',
                    redirect: {
                        url: `https://discord.com/channels/${config.guildId}`
                    }
                },
                custom_text: {
                    submit: {
                        message: `Obrigado pela compra! Volte ao Discord para receber seu produto.`
                    }
                }
            });

            logger.pagamento(metadata.checkout_id || 'N/A', 'STRIPE_LINK_GERADO', 'Stripe');

            return {
                url: paymentLink.url,
                payment_link_id: paymentLink.id,
                amount: amount,
                public_key: this.stripeConfig.public_key
            };
        } catch (error) {
            logger.erro('CRIAR_STRIPE_LINK', error, metadata.user_id);
            console.error('Stripe Error:', error);
            throw new Error(`Erro Stripe: ${error.message}`);
        }
    }

    // Stripe - Criar Payment Intent (para embed direto)
    async createStripePaymentIntent(amount, description, metadata = {}) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: Math.round(amount * 100),
                currency: 'brl',
                description: description,
                metadata: metadata,
                automatic_payment_methods: {
                    enabled: true,
                },
            });

            return {
                client_secret: paymentIntent.client_secret,
                payment_intent_id: paymentIntent.id,
                amount: amount,
                status: paymentIntent.status,
                public_key: this.stripeConfig.public_key
            };
        } catch (error) {
            logger.erro('CRIAR_PAYMENT_INTENT', error, metadata.user_id);
            throw error;
        }
    }

    // Verificar pagamento Stripe
    async checkStripePayment(paymentIntentId) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
            
            if (paymentIntent.status === 'succeeded') {
                logger.pagamento(paymentIntent.metadata.checkout_id || paymentIntentId, 'STRIPE_PAGO', 'Stripe');
            }

            return {
                status: paymentIntent.status,
                amount: paymentIntent.amount / 100,
                currency: paymentIntent.currency,
                metadata: paymentIntent.metadata,
                customer: paymentIntent.customer
            };
        } catch (error) {
            logger.erro('VERIFICAR_STRIPE', error, paymentIntentId);
            throw error;
        }
    }

    // Processar webhook do Stripe
    async handleStripeWebhook(payload, sig) {
        try {
            const event = this.stripe.webhooks.constructEvent(
                payload,
                sig,
                this.stripeConfig.webhook_secret
            );

            switch (event.type) {
                case 'payment_intent.succeeded':
                    const paymentIntent = event.data.object;
                    logger.venda(
                        paymentIntent.metadata.user_id || 'Desconhecido',
                        paymentIntent.metadata.product_name || 'Produto',
                        paymentIntent.amount / 100,
                        'Cartão/Boleto (Stripe)'
                    );
                    return { success: true, event: 'payment_succeeded', checkoutId: paymentIntent.metadata.checkout_id };
                    
                case 'payment_intent.payment_failed':
                    logger.erro('STRIPE_PAGAMENTO_FALHOU', new Error('Pagamento falhou'), event.data.object.metadata.user_id);
                    return { success: true, event: 'payment_failed' };
            }

            return { success: true, event: event.type };
        } catch (error) {
            logger.erro('WEBHOOK_STRIPE', error);
            throw error;
        }
    }
}

module.exports = new PaymentService();