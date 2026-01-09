const { ComponentType, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const productService = require("../services/product-service");
const checkoutService = require("../services/checkout-service");
const { formatPrice } = require("../@shared");

module.exports = {
    ProductMessage: async (productId) => {
        const product = productService.getProduct(productId);

        if (!product) {
            return {
                content: "❌ Produto não encontrado.",
                ephemeral: true
            };
        }

        const embed = new EmbedBuilder()
            .setTitle(product.title)
            .setDescription(product.description || "Sem descrição")
            .setColor("#5865F2")
            .setImage(product.image || null)
            .setFooter(product.footer ? { text: product.footer } : null);

        // Verificar se tem variantes
        const hasVariants = product.variants && product.variants.length > 0;

        const components = [];

        if (hasVariants) {
            // Menu de seleção para variantes
            const selectRow = new ActionRowBuilder()
                .addComponents({
                    type: ComponentType.StringSelect,
                    customId: `select-variant:${productId}`,
                    placeholder: "Selecione uma variação",
                    options: product.variants.map((variant) => ({
                        label: variant.title.slice(0, 25),
                        description: `${formatPrice(variant.price)} | ${variant.stock === null ? "∞ Estoque" : `${variant.stock} em estoque`}`,
                        value: variant.id,
                        emoji: "📦",
                    })),
                });

            components.push(selectRow);
        }

        // Botão de compra
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy-product:${productId}`)
                    .setLabel("🛒 Comprar Agora")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!hasVariants) // Desabilitar se tiver variantes (precisa selecionar primeiro)
            );

        components.push(buttonRow);

        return {
            embeds: [embed],
            components: components
        };
    },

    CheckoutPanel: async ({ interaction, checkoutId }) => {
        const checkout = checkoutService.getCheckout(checkoutId);
        const product = productService.getProduct(checkout.productId);

        if (!checkout || !product) {
            return {
                content: "❌ Checkout não encontrado.",
                ephemeral: true
            };
        }

        // Encontrar variante se existir
        let variantInfo = "";
        if (checkout.variantId && product.variants) {
            const variant = product.variants.find(v => v.id === checkout.variantId);
            if (variant) {
                variantInfo = `\n**Variação:** ${variant.title}`;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("🛒 Carrinho de Compras")
            .setDescription(`Olá ${interaction.user}, este é seu carrinho.\nPara finalizar, escolha a forma de pagamento abaixo.`)
            .setColor("#5865F2")
            .addFields(
                {
                    name: "📦 Produto",
                    value: `**${product.title}**${variantInfo}`,
                    inline: false
                },
                {
                    name: "💰 Preço Unitário",
                    value: `\`${formatPrice(checkout.unitPrice)}\``,
                    inline: true
                },
                {
                    name: "📊 Quantidade",
                    value: `\`${checkout.quantity}\``,
                    inline: true
                },
                {
                    name: "💵 Total",
                    value: `\`${formatPrice(checkout.total)}\``,
                    inline: true
                }
            );

        if (checkout.coupon) {
            embed.addFields({
                name: "🎫 Cupom Aplicado",
                value: `\`${checkout.coupon.code}\` - ${checkout.coupon.type === 'PERCENTAGE' ? `${checkout.coupon.amount}%` : formatPrice(checkout.coupon.amount)} de desconto`,
                inline: false
            });
        }

        // Botões de ação
        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`payment-pix:${checkoutId}`)
                    .setLabel("💰 Pagar com PIX")
                    .setStyle(ButtonStyle.Success)
                    .setEmoji("💸"),
                new ButtonBuilder()
                    .setCustomId(`payment-stripe:${checkoutId}`)
                    .setLabel("💳 Pagar com Cartão")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("💳"),
                new ButtonBuilder()
                    .setCustomId(`add-quantity:${checkoutId}`)
                    .setLabel("➕")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`remove-quantity:${checkoutId}`)
                    .setLabel("➖")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`cancel-checkout:${checkoutId}`)
                    .setLabel("❌ Cancelar")
                    .setStyle(ButtonStyle.Danger)
            );

        return {
            embeds: [embed],
            components: [actionRow]
        };
    },

    PaymentPanel: async ({ checkoutId, paymentMethod }) => {
        const checkout = checkoutService.getCheckout(checkoutId);
        const product = productService.getProduct(checkout.productId);

        if (paymentMethod === 'pix') {
            // Gerar QR Code PIX
            const paymentResult = await checkoutService.startPayment(checkoutId, 'pix');
            
            const embed = new EmbedBuilder()
                .setTitle("💰 Pagamento via PIX")
                .setDescription(`Escaneie o QR Code abaixo ou copie o código PIX para pagar.\n\n**Valor:** ${formatPrice(checkout.total)}\n**Válido por:** 30 minutos`)
                .setColor("#32CD32")
                .setImage(paymentResult.payment.qr_code) // QR Code image
                .addFields({
                    name: "Código PIX (Copiar e Colar)",
                    value: `\`\`\`${paymentResult.payment.pix_code}\`\`\``
                });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`check-payment:${checkoutId}`)
                        .setLabel("✅ Já Paguei")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`cancel-payment:${checkoutId}`)
                        .setLabel("❌ Cancelar")
                        .setStyle(ButtonStyle.Danger)
                );

            return { embeds: [embed], components: [row] };
        } else {
            // Pagamento Stripe
            const paymentResult = await checkoutService.startPayment(checkoutId, 'stripe');
            
            const embed = new EmbedBuilder()
                .setTitle("💳 Pagamento via Cartão/Boleto")
                .setDescription(`Clique no botão abaixo para prosseguir com o pagamento.\n\n**Valor:** ${formatPrice(checkout.total)}\n**Produto:** ${product.title}`)
                .setColor("#7289DA");

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("🌐 Pagar Agora")
                        .setStyle(ButtonStyle.Link)
                        .setURL(paymentResult.payment.url),
                    new ButtonBuilder()
                        .setCustomId(`check-payment:${checkoutId}`)
                        .setLabel("✅ Verificar Pagamento")
                        .setStyle(ButtonStyle.Success)
                );

            return { embeds: [embed], components: [row] };
        }
    }
};