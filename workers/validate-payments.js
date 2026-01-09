const { ComponentType, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const { db, checkoutService, formatPrice } = require("../@shared");
const config = require("../config.json");
const logger = require("../utils/logger");

module.exports = {
    execute: (client) => {
        client.on("clientReady", () => {
            const guild = client.guilds.cache.get(config.guildId);
            const intervalSeconds = config.settings?.payment_check_interval_seconds || 15;

            setInterval(async () => {
                try {
                    const all = db.all();
                    const checkouts = all.filter((entry) => {
                        return entry.ID.startsWith("checkout:") && entry.data.status === "PENDING";
                    });

                    logger.info(`Verificando ${checkouts.length} pagamentos pendentes...`);

                    for (const checkout of checkouts) {
                        const checkoutData = checkout.data;
                        
                        try {
                            // Verificar status do pagamento
                            const updatedCheckout = await checkoutService.checkPaymentStatus(checkoutData.id);
                            
                            if (updatedCheckout && updatedCheckout.status === "APPROVED") {
                                const channel = await guild.channels.cache.get(checkout.ID.split(":")[1]);
                                if (!channel) continue;

                                const member = await guild.members.cache.get(checkoutData.userId);
                                if (!member) continue;

                                // Enviar confirmação de pagamento
                                const embed = new EmbedBuilder()
                                    .setTitle(`${config.emojis.success} Pagamento Aprovado!`)
                                    .setDescription(`Seu pagamento foi confirmado com sucesso!`)
                                    .setColor("#00FF00")
                                    .addFields(
                                        {
                                            name: `${config.emojis.product} ID da Compra`,
                                            value: `\`${checkoutData.id}\``,
                                            inline: true
                                        },
                                        {
                                            name: `${config.emojis.money} Valor`,
                                            value: formatPrice(checkoutData.total),
                                            inline: true
                                        },
                                        {
                                            name: `${config.emojis.timer} Data`,
                                            value: new Date().toLocaleDateString('pt-BR'),
                                            inline: true
                                        }
                                    )
                                    .setTimestamp();

                                // Verificar gateway usado
                                const provider = checkoutData.payment?.provider;
                                const gatewayName = provider === 'mercado_pago' ? 'Mercado Pago PIX' : 
                                                   provider === 'stripe' ? 'Cartão/Boleto (Stripe)' : 'Pagamento';

                                embed.addFields({
                                    name: `${config.emojis.mercado_pago || config.emojis.stripe} Gateway`,
                                    value: gatewayName,
                                    inline: true
                                });

                                // Se for produto digital, adicionar link/download
                                const productType = checkoutData.productType || "digital";
                                if (productType === "digital") {
                                    embed.addFields({
                                        name: `${config.emojis.product} Download do Produto`,
                                        value: "Seu produto foi liberado! Use o comando `/meus-produtos` para acessar.",
                                        inline: false
                                    });

                                    // Botão para ver produtos (se configurado)
                                    if (config.settings.send_dm_on_purchase) {
                                        const row = new ActionRowBuilder()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId(`view_products_${checkoutData.userId}`)
                                                    .setLabel("📦 Ver Meus Produtos")
                                                    .setStyle(ButtonStyle.Primary)
                                            );

                                        await channel.send({ 
                                            content: `🎉 Parabéns <@${checkoutData.userId}>! Seu pagamento foi aprovado!`,
                                            embeds: [embed], 
                                            components: [row] 
                                        });
                                    } else {
                                        await channel.send({ 
                                            content: `🎉 Parabéns <@${checkoutData.userId}>! Seu pagamento foi aprovado!`,
                                            embeds: [embed] 
                                        });
                                    }
                                } else {
                                    await channel.send({ 
                                        content: `🎉 Parabéns <@${checkoutData.userId}>! Seu pagamento foi aprovado!`,
                                        embeds: [embed] 
                                    });
                                }

                                // Enviar DM para o usuário
                                try {
                                    const dmEmbed = new EmbedBuilder()
                                        .setTitle(`${config.emojis.success} Compra Aprovada!`)
                                        .setDescription(`Sua compra foi processada com sucesso!`)
                                        .setColor("#00FF00")
                                        .addFields(
                                            {
                                                name: "Produto",
                                                value: checkoutData.productName || "Produto Digital",
                                                inline: false
                                            },
                                            {
                                                name: "Valor",
                                                value: formatPrice(checkoutData.total),
                                                inline: true
                                            },
                                            {
                                                name: "Método",
                                                value: gatewayName,
                                                inline: true
                                            }
                                        )
                                        .setTimestamp();

                                    await member.send({ embeds: [dmEmbed] });
                                    logger.info(`DM enviada para usuário ${checkoutData.userId} - Checkout ${checkoutData.id}`);
                                } catch (error) {
                                    logger.info(`Não foi possível enviar DM para usuário ${checkoutData.userId}`);
                                }

                                // Registrar venda
                                logger.venda(
                                    checkoutData.userId,
                                    checkoutData.productName || "Produto",
                                    checkoutData.total,
                                    gatewayName
                                );
                            }
                        } catch (error) {
                            logger.erro('VERIFICAR_PAGAMENTO_CHECKOUT', error, checkoutData.id);
                        }
                    }

                    // Verificar checkouts expirados
                    const expiredCount = await checkoutService.checkExpiredCheckouts();
                    if (expiredCount > 0) {
                        logger.info(`${expiredCount} checkouts expirados foram atualizados`);
                    }

                } catch (error) {
                    logger.erro('VALIDATE_PAYMENTS_LOOP', error);
                }
            }, intervalSeconds * 1000); // Verificar a cada X segundos (15 por padrão)
        });
    },
};