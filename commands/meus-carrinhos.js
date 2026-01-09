const {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const checkoutService = require("../services/checkout-service");
const productService = require("../services/product-service");
const CartService = require("../services/cart-service");
const { formatPrice } = require("../@shared");
const logger = require("../utils/logger");

module.exports = {
    options: {
        name: "meus-carrinhos",
        type: ApplicationCommandType.ChatInput,
        description: "Ver e gerenciar seus carrinhos de compra",
        options: [
            {
                name: "acao",
                description: "Ação a ser realizada",
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: "📋 Listar carrinhos", value: "list" },
                    { name: "❌ Cancelar carrinho", value: "cancel" },
                    { name: "🧹 Limpar todos", value: "clear" }
                ]
            },
            {
                name: "checkout_id",
                description: "ID do carrinho para cancelar",
                type: ApplicationCommandOptionType.String,
                required: false,
            }
        ],
    },
    
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const action = interaction.options.getString("acao") || "list";
        const checkoutId = interaction.options.getString("checkout_id");

        try {
            switch (action) {
                case 'list':
                    await this.listCarts(interaction, client);
                    break;
                case 'cancel':
                    if (!checkoutId) {
                        return interaction.editReply("❌ Informe o ID do carrinho para cancelar.");
                    }
                    await this.cancelCart(interaction, checkoutId, client);
                    break;
                case 'clear':
                    await this.clearAllCarts(interaction, client);
                    break;
                default:
                    await interaction.editReply("❌ Ação inválida.");
            }
        } catch (error) {
            logger.erro('COMANDO_MEUS_CARRINHOS', error, interaction.user.id);
            await interaction.editReply("❌ Ocorreu um erro ao processar o comando.");
        }
    },

    // Listar carrinhos do usuário
    async listCarts(interaction, client) {
        const userId = interaction.user.id;
        const userCheckouts = checkoutService.getUserCheckouts(userId);
        
        // Filtrar apenas carrinhos ativos (DRAFT ou PENDING)
        const activeCheckouts = userCheckouts.filter(checkout => 
            checkout.status === 'DRAFT' || checkout.status === 'PENDING'
        );

        const completedCheckouts = userCheckouts.filter(checkout => 
            checkout.status === 'APPROVED' || checkout.status === 'COMPLETED'
        );

        const cancelledCheckouts = userCheckouts.filter(checkout => 
            checkout.status === 'CANCELLED'
        );

        if (activeCheckouts.length === 0 && completedCheckouts.length === 0 && cancelledCheckouts.length === 0) {
            return interaction.editReply("📭 Você não tem nenhum carrinho.");
        }

        const embed = new EmbedBuilder()
            .setTitle("🛒 SEUS CARRINHOS")
            .setColor(0x5865F2)
            .setDescription(`**Usuário:** <@${userId}>`)
            .setFooter({ text: "Use os botões abaixo para gerenciar" })
            .setTimestamp();

        // Carrinhos ativos
        if (activeCheckouts.length > 0) {
            let activeText = "";
            activeCheckouts.forEach((checkout, index) => {
                const product = productService.getProduct(checkout.productId);
                const statusEmoji = checkout.status === 'PENDING' ? '⏳' : '🛒';
                const statusText = checkout.status === 'PENDING' ? 'Aguardando pagamento' : 'Em andamento';
                
                activeText += `${index + 1}. ${statusEmoji} **${product?.title || 'Produto não encontrado'}**\n`;
                activeText += `   • **ID:** \`${checkout.id}\`\n`;
                activeText += `   • **Status:** ${statusText}\n`;
                activeText += `   • **Valor:** ${formatPrice(checkout.total)}\n`;
                activeText += `   • **Criado:** ${new Date(checkout.createdAt).toLocaleString('pt-BR')}\n\n`;
            });

            embed.addFields({
                name: `📝 ATIVOS (${activeCheckouts.length})`,
                value: activeText || "*Nenhum carrinho ativo*",
                inline: false
            });
        }

        // Carrinhos completados
        if (completedCheckouts.length > 0) {
            let completedText = "";
            completedCheckouts.slice(0, 3).forEach((checkout, index) => {
                const product = productService.getProduct(checkout.productId);
                completedText += `${index + 1}. ✅ **${product?.title || 'Produto não encontrado'}**\n`;
                completedText += `   • **ID:** \`${checkout.id}\`\n`;
                completedText += `   • **Valor:** ${formatPrice(checkout.total)}\n`;
                completedText += `   • **Data:** ${new Date(checkout.createdAt).toLocaleDateString('pt-BR')}\n\n`;
            });

            if (completedCheckouts.length > 3) {
                completedText += `... e mais ${completedCheckouts.length - 3} compras`;
            }

            embed.addFields({
                name: `✅ COMPLETADOS (${completedCheckouts.length})`,
                value: completedText || "*Nenhuma compra completada*",
                inline: false
            });
        }

        // Carrinhos cancelados
        if (cancelledCheckouts.length > 0) {
            let cancelledText = "";
            cancelledCheckouts.slice(0, 3).forEach((checkout, index) => {
                const product = productService.getProduct(checkout.productId);
                cancelledText += `${index + 1}. ❌ **${product?.title || 'Produto não encontrado'}**\n`;
                cancelledText += `   • **ID:** \`${checkout.id}\`\n`;
                cancelledText += `   • **Valor:** ${formatPrice(checkout.total)}\n`;
                cancelledText += `   • **Data:** ${new Date(checkout.createdAt).toLocaleDateString('pt-BR')}\n\n`;
            });

            if (cancelledCheckouts.length > 3) {
                cancelledText += `... e mais ${cancelledCheckouts.length - 3} cancelados`;
            }

            embed.addFields({
                name: `❌ CANCELADOS (${cancelledCheckouts.length})`,
                value: cancelledText || "*Nenhum carrinho cancelado*",
                inline: false
            });
        }

        // Botões de ação
        const row = new ActionRowBuilder();
        
        if (activeCheckouts.length > 0) {
            // Se tiver apenas um carrinho ativo, botão para cancelar específico
            if (activeCheckouts.length === 1) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`cancel_cart_${activeCheckouts[0].id}`)
                        .setLabel("❌ Cancelar Este Carrinho")
                        .setStyle(ButtonStyle.Danger)
                );
            }
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId("clear_all_carts")
                    .setLabel("🧹 Limpar Todos")
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        await interaction.editReply({ 
            embeds: [embed],
            components: activeCheckouts.length > 0 ? [row] : []
        });
    },

    // Cancelar carrinho específico
    async cancelCart(interaction, checkoutId, client) {
        const checkout = checkoutService.getCheckout(checkoutId);
        
        if (!checkout) {
            return interaction.editReply("❌ Carrinho não encontrado.");
        }

        if (checkout.userId !== interaction.user.id) {
            return interaction.editReply("❌ Este carrinho não pertence a você.");
        }

        if (checkout.status === 'CANCELLED' || checkout.status === 'COMPLETED') {
            return interaction.editReply("❌ Este carrinho já foi finalizado.");
        }

        // Cancelar checkout
        checkoutService.cancelCheckout(checkoutId);
        
        // Fechar canal se existir
        const cartService = new CartService(client);
        await cartService.closeCheckoutChannel(checkoutId);

        // Buscar produto para informações
        const product = productService.getProduct(checkout.productId);
        
        const embed = new EmbedBuilder()
            .setTitle("✅ CARRINHO CANCELADO")
            .setColor(0xFF0000)
            .addFields(
                {
                    name: "📦 Produto",
                    value: product?.title || "Desconhecido",
                    inline: true
                },
                {
                    name: "💰 Valor",
                    value: formatPrice(checkout.total),
                    inline: true
                },
                {
                    name: "📅 Cancelado em",
                    value: new Date().toLocaleString('pt-BR'),
                    inline: true
                }
            )
            .setFooter({ text: "Agora você pode criar um novo carrinho" })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        logger.info(`Carrinho cancelado por comando: ${checkoutId}`, {
            userId: interaction.user.id,
            product: product?.title,
            amount: checkout.total
        });
    },

    // Limpar todos os carrinhos
    async clearAllCarts(interaction, client) {
        const userId = interaction.user.id;
        const userCheckouts = checkoutService.getUserCheckouts(userId);
        
        // Filtrar apenas carrinhos que podem ser cancelados
        const cancellableCheckouts = userCheckouts.filter(checkout => 
            checkout.status === 'DRAFT' || checkout.status === 'PENDING'
        );

        if (cancellableCheckouts.length === 0) {
            return interaction.editReply("📭 Você não tem carrinhos ativos para limpar.");
        }

        const cartService = new CartService(client);
        let cancelledCount = 0;

        // Cancelar todos os carrinhos
        for (const checkout of cancellableCheckouts) {
            checkoutService.cancelCheckout(checkout.id);
            await cartService.closeCheckoutChannel(checkout.id);
            cancelledCount++;
        }

        const embed = new EmbedBuilder()
            .setTitle("🧹 TODOS OS CARRINHOS LIMPOS")
            .setColor(0x00FF00)
            .setDescription(`**${cancelledCount}** carrinho(s) cancelado(s) com sucesso!`)
            .addFields(
                {
                    name: "👤 Usuário",
                    value: `<@${userId}>`,
                    inline: true
                },
                {
                    name: "📅 Limpeza realizada",
                    value: new Date().toLocaleString('pt-BR'),
                    inline: true
                }
            )
            .setFooter({ text: "Agora você pode criar novos carrinhos" })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        logger.info(`Todos os carrinhos limpos para usuário ${interaction.user.tag}`, {
            userId: userId,
            cancelledCount: cancelledCount
        });
    }
};