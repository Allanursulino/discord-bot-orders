const { WebhookClient } = require('discord.js');
const config = require('../config.json');
const logger = require('../utils/logger');

class WebhookHandler {
    constructor() {
        this.webhook = new WebhookClient({ url: config.discord.webhook_url });
        this.logChannel = config.discord.log_channel;
        this.adminId = config.discord.admin_id;
    }

    // Enviar notificação de venda
    async sendSaleNotification(saleData) {
        try {
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
                        name: `${config.emojis.success} Valor`,
                        value: `R$ ${saleData.amount.toFixed(2)}`,
                        inline: true
                    },
                    {
                        name: `${config.emojis.stripe} Método`,
                        value: saleData.paymentMethod === 'pix' ? 'PIX (SumUp)' : 'Cartão/Boleto (Stripe)',
                        inline: true
                    },
                    {
                        name: `${config.emojis.success} Status`,
                        value: '✅ APROVADO',
                        inline: true
                    },
                    {
                        name: `${config.emojis.success} Data`,
                        value: new Date().toLocaleString('pt-BR'),
                        inline: true
                    },
                    {
                        name: '📋 Checkout ID',
                        value: `\`${saleData.checkoutId}\``,
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Sistema de Vendas • MultiHub'
                }
            };

            await this.webhook.send({
                content: `🎉 **NOVA VENDA!** <@${this.adminId}>`,
                embeds: [embed]
            });

            logger.info(`Notificação de venda enviada: ${saleData.checkoutId}`);
        } catch (error) {
            logger.erro('ENVIAR_NOTIFICACAO_VENDA', error);
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
        } catch (error) {
            console.error('Erro ao enviar log de erro:', error);
        }
    }

    // Enviar status do pagamento
    async sendPaymentStatus(paymentData) {
        try {
            const isSuccess = paymentData.status === 'paid' || paymentData.status === 'succeeded';
            
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
                        name: '🏦 Gateway',
                        value: paymentData.provider === 'sumup' ? 'SumUp (PIX)' : 'Stripe',
                        inline: true
                    },
                    {
                        name: '📊 Status',
                        value: isSuccess ? '✅ PAGO' : '⏳ PENDENTE',
                        inline: true
                    }
                ],
                timestamp: new Date().toISOString()
            };

            await this.webhook.send({
                embeds: [embed]
            });
        } catch (error) {
            logger.erro('ENVIAR_STATUS_PAGAMENTO', error);
        }
    }
}

module.exports = new WebhookHandler();