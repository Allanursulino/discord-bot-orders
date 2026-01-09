const axios = require('axios');
const qrcode = require('qrcode');
const Stripe = require('stripe');
const config = require('../config.json');
const logger = require('../utils/logger');

class PaymentService {
    constructor() {
        // Stripe
        this.stripe = new Stripe(config.payment.stripe.secret_key);
        this.stripeConfig = config.payment.stripe;
        
        // Mercado Pago
        this.mercadoPagoConfig = config.payment.mercadoPago;
        this.mercadoPagoBaseUrl = this.mercadoPagoConfig.environment === 'sandbox' 
            ? 'https://api.mercadopago.com/v1' 
            : 'https://api.mercadopago.com/v1';
        
        this.emojis = config.emojis;
        this.pixExpirationMinutes = config.settings.pix_expiration_minutes || 30;
    }

    // ========== MERCADO PAGO PIX ========== //

    /**
     * Criar pagamento PIX via Mercado Pago
     */
    async createMercadoPagoPixPayment(amount, description, checkoutId, userId) {
        try {
            logger.info(`Gerando PIX Mercado Pago para checkout ${checkoutId}`, { 
                amount, 
                description, 
                userId 
            });

            const amountInReais = parseFloat(amount).toFixed(2);
            const expirationDate = new Date();
            expirationDate.setMinutes(expirationDate.getMinutes() + this.pixExpirationMinutes);

            const pixData = {
                transaction_amount: parseFloat(amountInReais),
                description: description.substring(0, 255),
                payment_method_id: 'pix',
                payer: {
                    email: `${userId}@discord.user`,
                    first_name: `Discord`,
                    last_name: `User ${userId.substring(0, 5)}`,
                    identification: {
                        type: 'CPF',
                        number: '00000000191' // CPF genérico para teste/produção
                    }
                },
                external_reference: checkoutId,
                notification_url: this.mercadoPagoConfig.notification_url,
                statement_descriptor: 'DISCORD BOT',
                date_of_expiration: expirationDate.toISOString()
            };

            const response = await axios.post(
                `${this.mercadoPagoBaseUrl}/payments`,
                pixData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.mercadoPagoConfig.access_token}`,
                        'Content-Type': 'application/json',
                        'X-Integrator-ID': this.mercadoPagoConfig.integrator_id || ''
                    },
                    timeout: 10000
                }
            );

            if (response.data.status === 'rejected') {
                throw new Error(`Pagamento rejeitado: ${response.data.status_detail}`);
            }

            // Extrair dados do PIX
            const pixInfo = response.data.point_of_interaction?.transaction_data;
            
            if (!pixInfo) {
                throw new Error('Dados do PIX não retornados pelo Mercado Pago');
            }

            // Gerar QR Code como imagem base64
            let qrCodeBase64 = '';
            try {
                qrCodeBase64 = await qrcode.toDataURL(pixInfo.qr_code);
            } catch (qrError) {
                logger.erro('GERAR_QR_CODE', qrError, checkoutId);
                qrCodeBase64 = '';
            }

            logger.pagamento(checkoutId, 'PIX_GERADO', 'MercadoPago', {
                amount: amountInReais,
                pixId: response.data.id
            });

            return {
                payment_id: response.data.id,
                qr_code: qrCodeBase64,
                qr_code_text: pixInfo.qr_code,
                pix_code: pixInfo.qr_code_base64 || pixInfo.qr_code,
                copy_paste_code: pixInfo.qr_code,
                transaction_id: response.data.id,
                amount: amountInReais,
                expires_at: response.data.date_of_expiration,
                status: response.data.status,
                provider: 'mercado_pago',
                raw_response: response.data
            };

        } catch (error) {
            logger.erro('GERAR_PIX_MERCADO_PAGO', error, checkoutId);
            
            const errorMessage = error.response?.data?.message || 
                               error.response?.data?.error || 
                               error.message;
            
            console.error('Mercado Pago API Error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: errorMessage
            });
            
            throw new Error(`Erro ao gerar PIX (Mercado Pago): ${errorMessage}`);
        }
    }

    /**
     * Verificar status do pagamento PIX no Mercado Pago
     */
    async checkMercadoPagoPayment(paymentId) {
        try {
            const response = await axios.get(
                `${this.mercadoPagoBaseUrl}/payments/${paymentId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.mercadoPagoConfig.access_token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const status = response.data.status;
            const statusDetail = response.data.status_detail;
            
            let mappedStatus = 'pending';
            if (status === 'approved') {
                mappedStatus = 'paid';
            } else if (status === 'rejected' || status === 'cancelled') {
                mappedStatus = 'failed';
            }

            if (status === 'approved') {
                logger.pagamento(paymentId, 'PIX_PAGO', 'MercadoPago', {
                    transaction_id: response.data.id,
                    amount: response.data.transaction_amount
                });
            }

            return {
                status: mappedStatus,
                original_status: status,
                status_detail: statusDetail,
                transaction_id: response.data.id,
                payment_id: response.data.id,
                paid_at: response.data.date_approved,
                amount: response.data.transaction_amount,
                currency: response.data.currency_id,
                payer_email: response.data.payer?.email,
                external_reference: response.data.external_reference,
                raw_response: response.data
            };
        } catch (error) {
            logger.erro('VERIFICAR_PIX_MERCADO_PAGO', error, paymentId);
            
            if (error.response?.status === 404) {
                return {
                    status: 'not_found',
                    payment_id: paymentId,
                    error: 'Pagamento não encontrado'
                };
            }
            
            throw error;
        }
    }

    /**
     * Processar webhook do Mercado Pago
     */
    async handleMercadoPagoWebhook(payload) {
        try {
            const { id, type } = payload;
            
            if (type !== 'payment') {
                return { success: false, error: 'Tipo de webhook inválido' };
            }

            // Buscar detalhes do pagamento
            const paymentInfo = await this.checkMercadoPagoPayment(id);
            
            return {
                success: true,
                event: `payment.${paymentInfo.original_status}`,
                checkoutId: paymentInfo.external_reference,
                payment_id: id,
                status: paymentInfo.status,
                amount: paymentInfo.amount,
                user_email: paymentInfo.payer_email,
                raw_data: paymentInfo
            };

        } catch (error) {
            logger.erro('WEBHOOK_MERCADO_PAGO', error);
            return { success: false, error: error.message };
        }
    }

    // ========== STRIPE (MANTIDO) ========== //

    /**
     * Criar link de pagamento Stripe
     */
    async createStripePaymentLink(amount, description, metadata = {}) {
        try {
            logger.info(`Criando link Stripe: ${description}`, { amount, metadata });
            
            const paymentLink = await this.stripe.paymentLinks.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'brl',
                            product_data: {
                                name: description.substring(0, 300),
                                metadata: metadata
                            },
                            unit_amount: Math.round(amount * 100),
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

    /**
     * Criar Payment Intent Stripe
     */
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

    /**
     * Verificar pagamento Stripe
     */
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

    /**
     * Processar webhook do Stripe
     */
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

    // ========== MÉTODOS UNIFICADOS ========== //

    /**
     * Método unificado para criar pagamento (usa Mercado Pago para PIX)
     */
    async createPayment(paymentMethod, amount, description, checkoutId, userId, metadata = {}) {
        if (paymentMethod === 'pix') {
            return await this.createMercadoPagoPixPayment(amount, description, checkoutId, userId);
        } else {
            return await this.createStripePaymentLink(amount, description, {
                ...metadata,
                checkout_id: checkoutId,
                user_id: userId
            });
        }
    }

    /**
     * Método unificado para verificar pagamento
     */
    async checkPayment(provider, paymentId) {
        if (provider === 'mercado_pago' || provider === 'sumup') {
            return await this.checkMercadoPagoPayment(paymentId);
        } else {
            return await this.checkStripePayment(paymentId);
        }
    }

    /**
     * Método unificado para processar webhooks
     */
    async handleWebhook(provider, payload, sig = null) {
        if (provider === 'mercado_pago') {
            return await this.handleMercadoPagoWebhook(payload);
        } else {
            return await this.handleStripeWebhook(payload, sig);
        }
    }
}

module.exports = new PaymentService();