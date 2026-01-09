const { WebhookClient } = require('discord.js');
const config = require('../config.json');
const logger = require('../utils/logger');
const checkoutService = require('../services/checkout-service');
const paymentService = require('../services/payment-service');

class WebhookHandler {
    constructor() {
        this.webhook = new WebhookClient({ url: config.discord.webhook_url });
        this.logChannel = config.discord.log_channel;
        this.adminId = config.discord.admin_id;
    }

    // Processar webhook do Mercado Pago
    async handleMercadoPagoWebhook(payload) {
        try {
            logger.info('Webhook Mercado Pago recebido', { payload: JSON.stringify(payload) });
            
            const result = await paymentService.handleMercadoPagoWebhook(payload);
            
            if (result.success && result.checkoutId) {
                // Buscar checkout
                const checkout = checkoutService.getCheckout(result.checkoutId);
                if (checkout) {
                    // Atualizar status
                    const updatedCheckout = await checkoutService.checkPaymentStatus(checkout.id);
                    
                    if (updatedCheckout.status === 'APPROVED') {
                        // Enviar notificação de venda
                        await this.sendSaleNotification({
                            userId: checkout.userId,
                            username: `Discord User ${checkout.userId}`,
                            productName: checkout.productName || 'Produto',
                            amount: result.amount || checkout.total,
                            paymentMethod: 'pix',
                            checkoutId: checkout.id,
                            provider: 'Mercado Pago'
                        });
                    }
                    
                    return { success: true, checkout: updatedCheckout };
                }
            }
            
            return result;
        } catch (error) {
            logger.erro('PROCESSAR_WEBHOOK_MERCADO_PAGO', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação de venda (ATUALIZADO)
    async sendSaleNotification(saleData) {
        try {
            const provider = saleData.provider || (saleData.paymentMethod === 'pix' ? 'Mercado Pago PIX' : 'Stripe');
            const providerEmoji = saleData.paymentMethod === 'pix' ? config.emojis.mercado_pago : config.emojis.stripe;
            
            const embed = {
                title: `${config.emojis.success} NOVA VENDA REALIZADA!`,
                color: 0x00FF00,
                fields: [
                    {
                        name: `${config.emojis.pix} Cliente`,
                        value: `<@${saleData.userId}> (${saleData.username})`,
                        inline: true
                    },
                    {
                        name: `${config.emojis.cart} Produto`,
                        value: saleData.productName,
                        inline: true
                    },
                    {
                        name: `${config.emojis.money} Valor`,
                        value: `R$ ${saleData.amount.toFixed(2)}`,
                        inline: true
                    },
                    {
                        name: `${providerEmoji} Método`,
                        value: provider,
                        inline: true
                    },
                    {
                        name: `${config.emojis.success} Status`,
                        value: '✅ APROVADO',
                        inline: true
                    },
                    {
                        name: `${config.emojis.timer} Data`,
                        value: new Date().toLocaleString('pt-BR'),
                        inline: true
                    },
                    {
                        name: '📋 Checkout ID',
                        value: `\`${saleData.checkoutId}\``,
                        inline: false
                    },
                    {
                        name: '🌐 Gateway',
                        value: `Mercado Pago PIX`,
                        inline: true
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Sistema de Vendas • Mercado Pago PIX'
                }
            };

            await this.webhook.send({
                content: `🎉 **NOVA VENDA!** <@${this.adminId}>`,
                embeds: [embed]
            });

            logger.info(`Notificação de venda enviada: ${saleData.checkoutId}`);
            
            return { success: true };
        } catch (error) {
            logger.erro('ENVIAR_NOTIFICACAO_VENDA', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar log de erro
    async sendErrorLog(errorData) {
        try {
            const embed = {
                title: `${config.emojis.error} ERRO NO SISTEMA`,
                color: 0xFF0000,
                fields: [
                    {
                        name: '🔧 Contexto',
                        value: errorData.context,
                        inline: false
                    },
                    {
                        name: '❌ Erro',
                        value: `\`\`\`${errorData.error}\`\`\``,
                        inline: false
                    },
                    {
                        name: '👤 Usuário',
                        value: errorData.userId ? `<@${errorData.userId}>` : 'Sistema',
                        inline: true
                    },
                    {
                        name: '🕒 Hora',
                        value: new Date().toLocaleString('pt-BR'),
                        inline: true
                    }
                ],
                timestamp: new Date().toISOString()
            };

            await this.webhook.send({
                content: `⚠️ **ATENÇÃO ADMIN!** <@${this.adminId}>`,
                embeds: [embed]
            });
            
            return { success: true };
        } catch (error) {
            console.error('Erro ao enviar log de erro:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar status do pagamento (ATUALIZADO)
    async sendPaymentStatus(paymentData) {
        try {
            const isSuccess = paymentData.status === 'paid' || 
                            paymentData.status === 'succeeded' || 
                            paymentData.status === 'approved';
            
            const providerName = paymentData.provider === 'mercado_pago' ? 'Mercado Pago PIX' : 
                               paymentData.provider === 'stripe' ? 'Stripe' : 
                               paymentData.provider || 'Desconhecido';
            
            const providerEmoji = paymentData.provider === 'mercado_pago' ? config.emojis.mercado_pago : 
                                paymentData.provider === 'stripe' ? config.emojis.stripe : 
                                config.emojis.loading;
            
            const embed = {
                title: `${isSuccess ? config.emojis.success : config.emojis.loading} STATUS DO PAGAMENTO`,
                color: isSuccess ? 0x00FF00 : 0xFFA500,
                fields: [
                    {
                        name: '📋 Checkout ID',
                        value: `\`${paymentData.checkoutId}\``,
                        inline: true
                    },
                    {
                        name: '👤 Cliente',
                        value: `<@${paymentData.userId}>`,
                        inline: true
                    },
                    {
                        name: '💰 Valor',
                        value: `R$ ${paymentData.amount.toFixed(2)}`,
                        inline: true
                    },
                    {
                        name: `${providerEmoji} Gateway`,
                        value: providerName,
                        inline: true
                    },
                    {
                        name: '📊 Status',
                        value: isSuccess ? '✅ PAGO' : 
                               paymentData.status === 'pending' ? '⏳ PENDENTE' :
                               paymentData.status === 'failed' ? '❌ FALHOU' :
                               paymentData.status === 'expired' ? '⌛ EXPIRADO' :
                               '❓ DESCONHECIDO',
                        inline: true
                    },
                    {
                        name: '🆔 ID Pagamento',
                        value: `\`${paymentData.paymentId || 'N/A'}\``,
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: `Webhook • ${providerName}`
                }
            };

            await this.webhook.send({
                embeds: [embed]
            });
            
            return { success: true };
        } catch (error) {
            logger.erro('ENVIAR_STATUS_PAGAMENTO', error);
            return { success: false, error: error.message };
        }
    }

    // Método unificado para webhooks
    async handleWebhook(provider, payload, sig = null) {
        try {
            if (provider === 'mercado_pago') {
                return await this.handleMercadoPagoWebhook(payload);
            } else if (provider === 'stripe') {
                // Processar webhook Stripe (se necessário)
                const result = await paymentService.handleStripeWebhook(payload, sig);
                if (result.success && result.checkoutId) {
                    const checkout = checkoutService.getCheckout(result.checkoutId);
                    if (checkout) {
                        await this.sendSaleNotification({
                            userId: checkout.userId,
                            username: `Discord User ${checkout.userId}`,
                            productName: checkout.productName || 'Produto',
                            amount: checkout.total,
                            paymentMethod: 'card',
                            checkoutId: checkout.id,
                            provider: 'Stripe'
                        });
                    }
                }
                return result;
            } else {
                throw new Error(`Provedor de webhook desconhecido: ${provider}`);
            }
        } catch (error) {
            await this.sendErrorLog({
                context: `Webhook Handler (${provider})`,
                error: error.message,
                userId: null
            });
            throw error;
        }
    }
}

module.exports = new WebhookHandler();