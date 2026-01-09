const { ComponentType, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const { db, checkoutService, formatPrice } = require("../@shared");
const config = require("../config.json");

module.exports = {
    execute: (client) => {
        client.on("clientReady", () => {
            const guild = client.guilds.cache.get(config.guildId);

            setInterval(async () => {
                const all = db.all();
                const checkouts = all.filter((entry) => {
                    return entry.ID.startsWith("checkout:") && entry.data.status === "PENDING";
                });

                for (const checkout of checkouts) {
                    const checkoutData = checkout.data;
                    
                    // Verificar status do pagamento
                    const updatedCheckout = await checkoutService.checkPaymentStatus(checkoutData.id);
                    
                    if (updatedCheckout && updatedCheckout.status === "APPROVED") {
                        const channel = await guild.channels.cache.get(checkout.ID.split(":")[1]);
                        if (!channel) continue;

                        const member = await guild.members.cache.get(checkoutData.userId);
                        if (!member) continue;

                        // Enviar confirmação de pagamento
                        const embed = new EmbedBuilder()
                            .setTitle("✅ Pagamento Aprovado!")
                            .setDescription(`Seu pagamento foi confirmado com sucesso!\n\n**ID da Compra:** ${checkoutData.id}\n**Valor:** ${formatPrice(checkoutData.total)}\n**Data:** ${new Date().toLocaleDateString('pt-BR')}`)
                            .setColor("#00FF00")
                            .setTimestamp();

                        // Se for produto digital, adicionar link/download
                        if (checkoutData.productType === "digital") {
                            embed.addFields({
                                name: "📥 Download do Produto",
                                value: "Clique no botão abaixo para baixar seu produto",
                                inline: false
                            });

                            const row = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setLabel("⬇️ Baixar Produto")
                                        .setStyle(ButtonStyle.Link)
                                        .setURL("https://seusite.com/download/" + checkoutData.id)
                                );

                            await channel.send({ embeds: [embed], components: [row] });
                        } else {
                            await channel.send({ embeds: [embed] });
                        }

                        // Enviar DM para o usuário
                        try {
                            await member.send({ embeds: [embed] });
                        } catch (error) {
                            console.log("Não foi possível enviar DM para o usuário");
                        }
                    }
                }
            }, 30000); // Verificar a cada 30 segundos
        });
    },
};