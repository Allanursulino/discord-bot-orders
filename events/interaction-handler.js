const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const productService = require('../services/product-service');
const checkoutService = require('../services/checkout-service');
const CartService = require('../services/cart-service');
const logger = require('../utils/logger');
const { formatPrice } = require('../@shared');

module.exports = {
    type: Events.InteractionCreate,
    
    async execute(interaction, client) {
        // Lidar com botões
        if (interaction.isButton()) {
            const cartService = new CartService(client);
            
            try {
                // 🛒 BOTÃO "COMPRAR AGORA" / "BUY NOW"
                if (interaction.customId?.startsWith('buy:')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const productId = interaction.customId.split(':')[1];
                    const product = productService.getProduct(productId);
                    
                    if (!product) {
                        return interaction.editReply('❌ Produto não encontrado.');
                    }

                    // Verificar estoque
                    if (product.stock !== null && product.stock < 1) {
                        return interaction.editReply('❌ Produto esgotado.');
                    }

                    // Verificar se usuário já tem checkout ativo
                    const activeCheckout = await cartService.getUserActiveCheckout(interaction.user.id);
                    if (activeCheckout) {
                        const activeProduct = productService.getProduct(activeCheckout.productId);
                        const isBR = activeProduct?.region === 'br';
                        
                        const embed = new EmbedBuilder()
                            .setTitle('⚠️ VOCÊ JÁ TEM UM CARRINHO ATIVO!')
                            .setColor(0xFFA500)
                            .setDescription(isBR 
                                ? `Você já tem um carrinho em andamento.\n\n**Produto:** ${activeProduct?.title || 'Desconhecido'}\n**Valor:** ${formatPrice(activeCheckout.total)}\n**Status:** ${activeCheckout.status === 'PENDING' ? '⏳ Aguardando pagamento' : '🛒 Em andamento'}` 
                                : `You already have an active cart.\n\n**Product:** ${activeProduct?.title || 'Unknown'}\n**Amount:** ${formatPrice(activeCheckout.total)}\n**Status:** ${activeCheckout.status === 'PENDING' ? '⏳ Waiting payment' : '🛒 In progress'}`)
                            .addFields({
                                name: isBR ? '📋 O que fazer?' : '📋 What to do?',
                                value: isBR 
                                    ? '1. Use `/meus-carrinhos` para ver seus carrinhos\n2. Complete o pagamento do carrinho atual\n3. Ou cancele para criar um novo'
                                    : '1. Use `/meus-carrinhos` to see your carts\n2. Complete payment of current cart\n3. Or cancel to create a new one',
                                inline: false
                            })
                            .setFooter({ 
                                text: isBR 
                                    ? 'Use /meus-carrinhos para gerenciar' 
                                    : 'Use /meus-carrinhos to manage' 
                            })
                            .setTimestamp();

                        return interaction.editReply({ 
                            content: isBR 
                                ? '⚠️ Você já tem um carrinho ativo!' 
                                : '⚠️ You already have an active cart!',
                            embeds: [embed] 
                        });
                    }

                    // Criar checkout
                    const checkout = checkoutService.createCheckout(
                        interaction.user.id,
                        productId,
                        1
                    );

                    if (!checkout) {
                        const isBR = product.region === 'br';
                        return interaction.editReply(
                            isBR 
                            ? '❌ Erro ao criar carrinho. Estoque insuficiente.' 
                            : '❌ Error creating cart. Insufficient stock.'
                        );
                    }

                    // Criar canal de checkout
                    const channel = await cartService.createCheckoutChannel(interaction.user, checkout.id);
                    
                    if (!channel) {
                        return interaction.editReply('❌ Erro ao criar canal de checkout. Contate um administrador.');
                    }

                    // Enviar painel do carrinho
                    await cartService.sendCartPanel(channel, checkout.id, interaction.user.id);
                    
                    const isBR = product.region === 'br';
                    await interaction.editReply(
                        isBR 
                        ? `✅ Carrinho criado! Acesse: ${channel}` 
                        : `✅ Cart created! Access: ${channel}`
                    );
                }

                // ℹ️ BOTÃO "DETALHES" / "DETAILS"
                else if (interaction.customId?.startsWith('details:')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const productId = interaction.customId.split(':')[1];
                    const product = productService.getProduct(productId);
                    const regionInfo = productService.getProductRegionInfo(productId);
                    
                    if (!product) {
                        return interaction.editReply('❌ Produto não encontrado.');
                    }

                    const isBR = product.region === 'br';
                    
                    const embed = new EmbedBuilder()
                        .setTitle(`${regionInfo.emojis?.flag || '📦'} ${product.title}`)
                        .setDescription(product.description || (isBR ? 'Sem descrição' : 'No description'))
                        .setColor(0x5865F2)
                        .addFields(
                            {
                                name: isBR ? '💰 Preço' : '💰 Price',
                                value: `${regionInfo.emojis?.currency || ''} ${product.price.toFixed(2)} ${product.currency}`,
                                inline: true
                            },
                            {
                                name: isBR ? '📦 Estoque' : '📦 Stock',
                                value: product.stock === null ? 
                                    (isBR ? '∞ Ilimitado' : '∞ Unlimited') : 
                                    (isBR ? product.stock + ' unidades' : product.stock + ' units'),
                                inline: true
                            },
                            {
                                name: isBR ? '🌍 Região' : '🌍 Region',
                                value: regionInfo.name,
                                inline: true
                            },
                            {
                                name: isBR ? '📅 Criado em' : '📅 Created',
                                value: new Date(product.created_at).toLocaleDateString('pt-BR'),
                                inline: true
                            }
                        )
                        .setFooter({ 
                            text: isBR 
                                ? 'Clique em "🛒 COMPRAR AGORA" para adquirir' 
                                : 'Click "🛒 BUY NOW" to purchase' 
                        })
                        .setTimestamp();

                    if (product.image) {
                        embed.setImage(product.image);
                    }

                    await interaction.editReply({ embeds: [embed] });
                }

                // ❌ BOTÃO "CANCELAR COMPRA" / "CANCEL PURCHASE" no painel do produto
                else if (interaction.customId?.startsWith('check_cancel:')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const productId = interaction.customId.split(':')[1];
                    const product = productService.getProduct(productId);
                    const isBR = product?.region === 'br' || true;
                    
                    // Verificar se usuário tem carrinhos ativos
                    const activeCheckout = await cartService.getUserActiveCheckout(interaction.user.id);
                    
                    if (!activeCheckout) {
                        return interaction.editReply(
                            isBR 
                            ? '❌ Você não tem nenhuma compra ativa para cancelar.' 
                            : '❌ You don\'t have any active purchase to cancel.'
                        );
                    }
                    
                    // Verificar se o carrinho ativo é deste produto
                    const activeProduct = productService.getProduct(activeCheckout.productId);
                    
                    const embed = new EmbedBuilder()
                        .setTitle(isBR ? '❌ CANCELAR COMPRA ATIVA' : '❌ CANCEL ACTIVE PURCHASE')
                        .setColor(0xFF0000)
                        .addFields(
                            {
                                name: isBR ? '📦 Produto Ativo' : '📦 Active Product',
                                value: activeProduct?.title || (isBR ? 'Desconhecido' : 'Unknown'),
                                inline: true
                            },
                            {
                                name: isBR ? '💰 Valor' : '💰 Amount',
                                value: formatPrice(activeCheckout.total),
                                inline: true
                            },
                            {
                                name: isBR ? '📋 Status' : '📋 Status',
                                value: activeCheckout.status === 'PENDING' 
                                    ? (isBR ? '⏳ Aguardando pagamento' : '⏳ Waiting payment')
                                    : (isBR ? '🛒 Em andamento' : '🛒 In progress'),
                                inline: true
                            }
                        );
                    
                    // Botões de confirmação
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('confirm_cancel_' + activeCheckout.id)
                                .setLabel(isBR ? '✅ SIM, CANCELAR' : '✅ YES, CANCEL')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('cancel_cancel')
                                .setLabel(isBR ? '❌ NÃO, MANTER' : '❌ NO, KEEP')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    
                    await interaction.editReply({
                        content: isBR 
                            ? '⚠️ **Tem certeza que deseja cancelar sua compra ativa?**\nEsta ação não pode ser desfeita!' 
                            : '⚠️ **Are you sure you want to cancel your active purchase?**\nThis action cannot be undone!',
                        embeds: [embed],
                        components: [row]
                    });
                }

                // ✅ Botão de confirmação de cancelamento
                else if (interaction.customId?.startsWith('confirm_cancel_')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const checkoutId = interaction.customId.replace('confirm_cancel_', '');
                    const checkout = checkoutService.getCheckout(checkoutId);
                    
                    if (!checkout || checkout.userId !== interaction.user.id) {
                        return interaction.editReply('❌ Carrinho não encontrado ou não pertence a você.');
                    }
                    
                    checkoutService.cancelCheckout(checkoutId);
                    
                    // Fechar canal se existir
                    await cartService.closeCheckoutChannel(checkoutId);
                    
                    const product = productService.getProduct(checkout.productId);
                    const isBR = product?.region === 'br';
                    
                    await interaction.editReply({
                        content: isBR 
                            ? '✅ **Compra cancelada com sucesso!**\n\n📦 **Produto:** ' + (product?.title || 'Desconhecido') + '\n💰 **Valor:** ' + formatPrice(checkout.total)
                            : '✅ **Purchase cancelled successfully!**\n\n📦 **Product:** ' + (product?.title || 'Unknown') + '\n💰 **Amount:** ' + formatPrice(checkout.total)
                    });
                }

                // ❌ Botão para manter o carrinho (não cancelar)
                else if (interaction.customId === 'cancel_cancel') {
                    await interaction.deferUpdate();
                    await interaction.deleteReply();
                }

                // 🎫 BOTÃO "ADICIONAR CUPOM" / "ADD COUPON" no painel do produto
                else if (interaction.customId?.startsWith('check_coupon:')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const productId = interaction.customId.split(':')[1];
                    const product = productService.getProduct(productId);
                    const isBR = product?.region === 'br' || true;
                    
                    // Verificar se usuário tem carrinho ativo
                    const activeCheckout = await cartService.getUserActiveCheckout(interaction.user.id);
                    
                    if (!activeCheckout) {
                        return interaction.editReply(
                            isBR 
                            ? '❌ Você precisa ter um carrinho ativo para adicionar cupom.\n\nClique em "🛒 COMPRAR AGORA" primeiro.' 
                            : '❌ You need an active cart to add a coupon.\n\nClick "🛒 BUY NOW" first.'
                        );
                    }
                    
                    // Criar modal para inserir cupom
                    const modal = new ModalBuilder()
                        .setCustomId('apply_coupon_modal_' + activeCheckout.id)
                        .setTitle(isBR ? 'Aplicar Cupom' : 'Apply Coupon');

                    const couponInput = new TextInputBuilder()
                        .setCustomId('coupon_code_input')
                        .setLabel(isBR ? 'Código do Cupom' : 'Coupon Code')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(20)
                        .setPlaceholder(isBR ? 'Ex: PROMO10' : 'Ex: PROMO10');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(couponInput)
                    );

                    await interaction.showModal(modal);
                }

                // 💰 BOTÃO "PAGAR COM PIX" (BR apenas)
                else if (interaction.customId?.startsWith('pay_pix:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const cartService = new CartService(client);
                    await cartService.sendPixPayment(interaction.channel, checkoutId, interaction.user.id);
                }

                // 💳 BOTÃO "PAGAR COM CARTÃO" / "PAY WITH CARD"
                else if (interaction.customId?.startsWith('pay_card:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const cartService = new CartService(client);
                    await cartService.sendStripePayment(interaction.channel, checkoutId, interaction.user.id);
                }

                // ✅ BOTÃO "JÁ PAGUEI" / "CHECK PAYMENT"
                else if (interaction.customId?.startsWith('check_payment:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const cartService = new CartService(client);
                    await cartService.sendPaymentConfirmation(interaction.channel, checkoutId, interaction.user.id);
                }

                // ➕ BOTÃO "AUMENTAR QUANTIDADE"
                else if (interaction.customId?.startsWith('increase:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const channel = interaction.channel;
                    const userId = interaction.user.id;
                    const cartService = new CartService(client);
                    
                    await cartService.updateCartQuantity(channel, checkoutId, userId, 1);
                }

                // ➖ BOTÃO "DIMINUIR QUANTIDADE"
                else if (interaction.customId?.startsWith('decrease:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const channel = interaction.channel;
                    const userId = interaction.user.id;
                    const cartService = new CartService(client);
                    
                    await cartService.updateCartQuantity(channel, checkoutId, userId, -1);
                }

                // ❌ BOTÃO "CANCELAR" no painel do carrinho
                else if (interaction.customId?.startsWith('cancel:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const checkout = checkoutService.getCheckout(checkoutId);
                    
                    if (checkout && checkout.userId === interaction.user.id) {
                        checkoutService.cancelCheckout(checkoutId);
                        
                        const product = productService.getProduct(checkout.productId);
                        const isBR = product?.region === 'br';
                        
                        const embed = new EmbedBuilder()
                            .setTitle(isBR ? '❌ Compra Cancelada' : '❌ Purchase Canceled')
                            .setDescription(isBR ? 'Sua compra foi cancelada.' : 'Your purchase has been canceled.')
                            .setColor(0xFF0000)
                            .addFields(
                                {
                                    name: isBR ? '📦 Produto' : '📦 Product',
                                    value: product?.title || (isBR ? 'Desconhecido' : 'Unknown'),
                                    inline: true
                                },
                                {
                                    name: isBR ? '💰 Valor' : '💰 Amount',
                                    value: formatPrice(checkout.total),
                                    inline: true
                                }
                            )
                            .setTimestamp();
                        
                        await interaction.channel.send({ embeds: [embed] });
                        
                        // Fechar canal após 5 segundos
                        setTimeout(() => {
                            const cartService = new CartService(client);
                            cartService.closeCheckoutChannel(checkoutId);
                        }, 5000);
                    }
                }

                // ↩️ BOTÃO "VOLTAR" / "BACK"
                else if (interaction.customId?.startsWith('back_to_cart:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const cartService = new CartService(client);
                    await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                    
                    // Apagar mensagem atual se possível
                    if (interaction.message.deletable) {
                        await interaction.message.delete().catch(() => {});
                    }
                }

                // 🎫 BOTÃO "ADICIONAR CUPOM" / "ADD COUPON" no painel do carrinho
                else if (interaction.customId?.startsWith('add_coupon:')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const checkout = checkoutService.getCheckout(checkoutId);
                    
                    if (!checkout || checkout.userId !== interaction.user.id) {
                        return interaction.editReply('❌ Carrinho não encontrado.');
                    }

                    const product = productService.getProduct(checkout.productId);
                    const isBR = product?.region === 'br';

                    // Criar modal para inserir cupom
                    const modal = new ModalBuilder()
                        .setCustomId('apply_coupon_' + checkoutId)
                        .setTitle(isBR ? 'Aplicar Cupom' : 'Apply Coupon');

                    const couponInput = new TextInputBuilder()
                        .setCustomId('coupon_code')
                        .setLabel(isBR ? 'Código do Cupom' : 'Coupon Code')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(20)
                        .setPlaceholder(isBR ? 'Digite o código do cupom' : 'Enter coupon code');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(couponInput)
                    );

                    await interaction.showModal(modal);
                }

                // 🗑️ BOTÃO "REMOVER CUPOM" / "REMOVE COUPON"
                else if (interaction.customId?.startsWith('remove_coupon:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const checkout = checkoutService.getCheckout(checkoutId);
                    
                    if (checkout && checkout.userId === interaction.user.id && checkout.coupon) {
                        checkoutService.removeCoupon(checkoutId);
                        
                        // Atualizar painel
                        const cartService = new CartService(client);
                        await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                        
                        // Apagar mensagem antiga
                        if (interaction.message.deletable) {
                            await interaction.message.delete().catch(() => {});
                        }
                    }
                }

                // 🗑️ BOTÃO "REMOVER PRODUTO" / "REMOVE PRODUCT" no carrinho
                else if (interaction.customId?.startsWith('remove_product:')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.split(':')[1];
                    const checkout = checkoutService.getCheckout(checkoutId);
                    
                    if (!checkout || checkout.userId !== interaction.user.id) {
                        return;
                    }
                    
                    const product = productService.getProduct(checkout.productId);
                    const isBR = product?.region === 'br' || true;
                    
                    // Criar embed de confirmação
                    const embed = new EmbedBuilder()
                        .setTitle(isBR ? '🗑️ REMOVER PRODUTO DO CARRINHO' : '🗑️ REMOVE PRODUCT FROM CART')
                        .setDescription(isBR 
                            ? `Tem certeza que deseja remover **${product?.title || 'este produto'}** do seu carrinho?\n\nEsta ação não pode ser desfeita!`
                            : `Are you sure you want to remove **${product?.title || 'this product'}** from your cart?\n\nThis action cannot be undone!`)
                        .setColor(0xFF0000)
                        .addFields(
                            {
                                name: isBR ? '📦 Produto' : '📦 Product',
                                value: product?.title || (isBR ? 'Desconhecido' : 'Unknown'),
                                inline: true
                            },
                            {
                                name: isBR ? '💰 Valor' : '💰 Amount',
                                value: formatPrice(checkout.total),
                                inline: true
                            }
                        )
                        .setTimestamp();
                    
                    // Botões de confirmação
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('confirm_remove_' + checkoutId)
                                .setLabel(isBR ? '✅ SIM, REMOVER' : '✅ YES, REMOVE')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('cancel_remove_' + checkoutId)
                                .setLabel(isBR ? '❌ NÃO, MANTER' : '❌ NO, KEEP')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    
                    await interaction.channel.send({
                        content: `<@${interaction.user.id}>`,
                        embeds: [embed],
                        components: [row]
                    });
                }

                // ✅ Botão de confirmação para remover produto do carrinho
                else if (interaction.customId?.startsWith('confirm_remove_')) {
                    await interaction.deferUpdate();
                    
                    const checkoutId = interaction.customId.replace('confirm_remove_', '');
                    const cartService = new CartService(client);
                    
                    const result = await cartService.removeProductFromCart(
                        interaction.channel, 
                        checkoutId, 
                        interaction.user.id
                    );
                    
                    if (result.success) {
                        const product = productService.getProduct(checkoutService.getCheckout(checkoutId)?.productId);
                        const isBR = product?.region === 'br' || true;
                        
                        const embed = new EmbedBuilder()
                            .setTitle(isBR ? '🗑️ PRODUTO REMOVIDO' : '🗑️ PRODUCT REMOVED')
                            .setDescription(isBR 
                                ? `**${result.productTitle}** foi removido do seu carrinho.` 
                                : `**${result.productTitle}** has been removed from your cart.`)
                            .setColor(0xFF0000)
                            .setTimestamp();
                        
                        await interaction.channel.send({ embeds: [embed] });
                        
                        // Apagar mensagens antigas do carrinho
                        const messages = await interaction.channel.messages.fetch({ limit: 10 });
                        messages.forEach(msg => {
                            if (msg.deletable && msg.author.id === client.user.id) {
                                msg.delete().catch(() => {});
                            }
                        });
                        
                        // Fechar canal após 5 segundos
                        setTimeout(() => {
                            cartService.closeCheckoutChannel(checkoutId);
                        }, 5000);
                    }
                }

                // ❌ Botão para não remover produto do carrinho
                else if (interaction.customId?.startsWith('cancel_remove_')) {
                    await interaction.deferUpdate();
                    await interaction.message.delete().catch(() => {});
                }

                // 📋 BOTÃO "MEUS CARRINHOS" no painel
                else if (interaction.customId === 'show_my_carts') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    // Simular comando /meus-carrinhos
                    try {
                        const meusCarrinhosCommand = require('../commands/meus-carrinhos');
                        await meusCarrinhosCommand.listCarts(interaction, client);
                    } catch (error) {
                        logger.erro('SHOW_MY_CARTS_BUTTON', error, interaction.user.id);
                        await interaction.editReply('❌ Erro ao carregar carrinhos. Use o comando `/meus-carrinhos`.');
                    }
                }

                // ❓ BOTÃO "AJUDA" no painel
                else if (interaction.customId === 'need_help') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    // Tentar encontrar checkout atual
                    let checkout = null;
                    let product = null;
                    
                    // Verificar se há checkout no canal atual
                    const messages = await interaction.channel.messages.fetch({ limit: 10 });
                    for (const msg of messages.values()) {
                        if (msg.components.length > 0) {
                            const button = msg.components[0]?.components[0];
                            if (button?.customId?.includes('pay_')) {
                                const checkoutId = button.customId.split(':')[1];
                                checkout = checkoutService.getCheckout(checkoutId);
                                if (checkout) {
                                    product = productService.getProduct(checkout.productId);
                                    break;
                                }
                            }
                        }
                    }
                    
                    const isBR = product?.region === 'br' || true; // Default para BR se não conseguir detectar
                    
                    const embed = new EmbedBuilder()
                        .setTitle(isBR ? '❓ AJUDA - CARRINHO DE COMPRAS' : '❓ HELP - SHOPPING CART')
                        .setColor(0x5865F2)
                        .addFields(
                            {
                                name: isBR ? '🛒 Como comprar?' : '🛒 How to buy?',
                                value: isBR 
                                    ? '1. Escolha a forma de pagamento (PIX ou Cartão)\n2. Siga as instruções de pagamento\n3. Após pagar, clique em "✅ JÁ PAGUEI"\n4. Aguarde a confirmação e receba seu produto'
                                    : '1. Choose payment method (Card only)\n2. Follow payment instructions\n3. After paying, click "✅ CHECK PAYMENT"\n4. Wait for confirmation and receive your product',
                                inline: false
                            },
                            {
                                name: isBR ? '💰 Métodos de pagamento' : '💰 Payment methods',
                                value: isBR 
                                    ? '• **PIX:** Pagamento instantâneo via QR Code\n• **Cartão:** Cartão de crédito/débito ou boleto'
                                    : '• **Card:** Credit/debit card only',
                                inline: false
                            },
                            {
                                name: isBR ? '❌ Problemas?' : '❌ Problems?',
                                value: isBR 
                                    ? '• **Carrinho travado?** Use `/meus-carrinhos`\n• **Pagamento não confirma?** Aguarde alguns minutos\n• **Precisa de ajuda?** Contate um administrador'
                                    : '• **Cart stuck?** Use `/meus-carrinhos`\n• **Payment not confirming?** Wait a few minutes\n• **Need help?** Contact an administrator',
                                inline: false
                            }
                        )
                        .setFooter({ 
                            text: isBR 
                                ? 'Para cancelar este carrinho, use o botão ❌ abaixo' 
                                : 'To cancel this cart, use the ❌ button below' 
                        })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                }

                // Botão para cancelar carrinho específico (do comando /meus-carrinhos)
                else if (interaction.customId?.startsWith('cancel_cart_')) {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const checkoutId = interaction.customId.replace('cancel_cart_', '');
                    const checkout = checkoutService.getCheckout(checkoutId);
                    
                    if (!checkout || checkout.userId !== interaction.user.id) {
                        return interaction.editReply('❌ Carrinho não encontrado ou não pertence a você.');
                    }

                    if (checkout.status === 'CANCELLED' || checkout.status === 'COMPLETED') {
                        return interaction.editReply('❌ Este carrinho já foi finalizado.');
                    }

                    // Cancelar checkout
                    checkoutService.cancelCheckout(checkoutId);
                    
                    // Fechar canal se existir
                    const cartService = new CartService(client);
                    await cartService.closeCheckoutChannel(checkoutId);

                    const product = productService.getProduct(checkout.productId);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('✅ CARRINHO CANCELADO')
                        .setColor(0xFF0000)
                        .addFields(
                            {
                                name: '📦 Produto',
                                value: product?.title || 'Desconhecido',
                                inline: true
                            },
                            {
                                name: '💰 Valor',
                                value: formatPrice(checkout.total),
                                inline: true
                            }
                        )
                        .setFooter({ text: 'Agora você pode criar um novo carrinho' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                }

                // Botão para limpar todos os carrinhos
                else if (interaction.customId === 'clear_all_carts') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const userId = interaction.user.id;
                    const userCheckouts = checkoutService.getUserCheckouts(userId);
                    
                    const cancellableCheckouts = userCheckouts.filter(checkout => 
                        checkout.status === 'DRAFT' || checkout.status === 'PENDING'
                    );

                    if (cancellableCheckouts.length === 0) {
                        return interaction.editReply('📭 Você não tem carrinhos ativos para limpar.');
                    }

                    const cartService = new CartService(client);
                    let cancelledCount = 0;
                    
                    for (const checkout of cancellableCheckouts) {
                        checkoutService.cancelCheckout(checkout.id);
                        await cartService.closeCheckoutChannel(checkout.id);
                        cancelledCount++;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('🧹 TODOS OS CARRINHOS LIMPOS')
                        .setColor(0x00FF00)
                        .setDescription('**' + cancelledCount + '** carrinho(s) cancelado(s) com sucesso!')
                        .setFooter({ text: 'Agora você pode criar novos carrinhos' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                }

                // ============================================
                // BOTÕES DE GERENCIAMENTO DE PRODUTOS (ADMIN)
                // ============================================

                // 🗑️ BOTÃO "APAGAR PRODUTO" (admin)
                else if (interaction.customId === 'admin_select_product') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.editReply('❌ Apenas administradores podem apagar produtos.');
                    }
                    
                    const products = productService.getAllProducts();
                    
                    if (products.length === 0) {
                        return interaction.editReply('📭 Não há produtos para apagar.');
                    }
                    
                    // Criar menu de seleção
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('delete_product_select')
                        .setPlaceholder('Selecione o produto para apagar...')
                        .setMinValues(1)
                        .setMaxValues(products.length);
                    
                    // Adicionar opções
                    products.forEach((product, index) => {
                        const regionEmoji = product.region === 'br' ? '🇧🇷' : '🌍';
                        selectMenu.addOptions({
                            label: `${product.title.substring(0, 50)}`,
                            description: `ID: ${product.id.substring(0, 8)}... | ${formatPrice(product.price)}`,
                            value: product.id,
                            emoji: regionEmoji
                        });
                    });
                    
                    const row = new ActionRowBuilder()
                        .addComponents(selectMenu);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🗑️ APAGAR PRODUTO')
                        .setDescription('**Selecione um ou mais produtos para apagar:**\n\n⚠️ **ATENÇÃO:** Esta ação não pode ser desfeita!')
                        .setColor(0xFF0000)
                        .setFooter({ text: 'Você pode selecionar múltiplos produtos' })
                        .setTimestamp();
                    
                    await interaction.editReply({
                        embeds: [embed],
                        components: [row]
                    });
                }

                // ✏️ BOTÃO "EDITAR PRODUTO" (admin)
                else if (interaction.customId === 'admin_edit_product') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.editReply('❌ Apenas administradores podem editar produtos.');
                    }
                    
                    const products = productService.getAllProducts();
                    
                    if (products.length === 0) {
                        return interaction.editReply('📭 Não há produtos para editar.');
                    }
                    
                    // Criar menu de seleção
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('edit_product_select')
                        .setPlaceholder('Selecione o produto para editar...')
                        .setMinValues(1)
                        .setMaxValues(1);
                    
                    // Adicionar opções
                    products.forEach((product, index) => {
                        const regionEmoji = product.region === 'br' ? '🇧🇷' : '🌍';
                        selectMenu.addOptions({
                            label: `${product.title.substring(0, 50)}`,
                            description: `ID: ${product.id.substring(0, 8)}... | ${formatPrice(product.price)}`,
                            value: product.id,
                            emoji: regionEmoji
                        });
                    });
                    
                    const row = new ActionRowBuilder()
                        .addComponents(selectMenu);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('✏️ EDITAR PRODUTO')
                        .setDescription('**Selecione um produto para editar:**')
                        .setColor(0x5865F2)
                        .setFooter({ text: 'Você poderá editar título, preço, estoque e descrição' })
                        .setTimestamp();
                    
                    await interaction.editReply({
                        embeds: [embed],
                        components: [row]
                    });
                }

                // ➕ BOTÃO "CRIAR PRODUTO" (admin)
                else if (interaction.customId === 'admin_create_product') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.editReply('❌ Apenas administradores podem criar produtos.');
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('➕ CRIAR NOVO PRODUTO')
                        .setDescription('**Escolha o tipo de produto que deseja criar:**')
                        .setColor(0x00FF00)
                        .addFields(
                            {
                                name: '🇧🇷 Produto Brasil',
                                value: 'Use `/produto-br` para criar produto brasileiro\n• Pagamento: PIX + Cartão\n• Moeda: BRL (R$)',
                                inline: false
                            },
                            {
                                name: '🌍 Produto Internacional',
                                value: 'Use `/produto-intl` para criar produto internacional\n• Pagamento: Cartão apenas\n• Moeda: USD ($)',
                                inline: false
                            }
                        )
                        .setFooter({ text: 'Os produtos são automaticamente publicados nos canais apropriados' })
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [embed] });
                }

                // 🌎 BOTÕES DE FILTRO (admin)
                else if (interaction.customId === 'admin_list_all_products') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const listarProdutosCommand = require('../commands/listar-produtos');
                    
                    await listarProdutosCommand.execute(interaction);
                }

                else if (interaction.customId === 'admin_list_br_products') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const listarProdutosCommand = require('../commands/listar-produtos');
                    
                    // Criar uma interação simulada com opção de região BR
                    const mockInteraction = {
                        ...interaction,
                        options: {
                            getString: (name) => 'br'
                        }
                    };
                    
                    await listarProdutosCommand.execute(mockInteraction);
                }

                else if (interaction.customId === 'admin_list_intl_products') {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const listarProdutosCommand = require('../commands/listar-produtos');
                    
                    // Criar uma interação simulada com opção de região INTL
                    const mockInteraction = {
                        ...interaction,
                        options: {
                            getString: (name) => 'intl'
                        }
                    };
                    
                    await listarProdutosCommand.execute(mockInteraction);
                }

            } catch (error) {
                logger.erro('INTERACTION_HANDLER', error, interaction.user?.id);
                
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply('❌ Ocorreu um erro. Tente novamente.');
                    } else {
                        await interaction.reply({
                            content: '❌ Ocorreu um erro. Tente novamente.',
                            ephemeral: true
                        });
                    }
                } catch (replyError) {
                    console.error('Erro ao enviar mensagem de erro:', replyError);
                }
            }
        }

        // Lidar com menus de seleção
        else if (interaction.isStringSelectMenu()) {
            
            // HANDLER PARA MENU DE SELEÇÃO DE APAGAR PRODUTO
            if (interaction.customId === 'delete_product_select') {
                await interaction.deferReply({ ephemeral: true });
                
                if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.editReply('❌ Apenas administradores podem apagar produtos.');
                }
                
                const selectedProductIds = interaction.values;
                const deletedProducts = [];
                const errorProducts = [];
                
                // Apagar cada produto selecionado
                for (const productId of selectedProductIds) {
                    try {
                        const product = productService.getProduct(productId);
                        if (product) {
                            const success = productService.deleteProduct(productId);
                            if (success) {
                                deletedProducts.push(product);
                            } else {
                                errorProducts.push(productId);
                            }
                        }
                    } catch (error) {
                        errorProducts.push(productId);
                        logger.erro('APAGAR_PRODUTO', error, interaction.user.id);
                    }
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('🗑️ PRODUTOS APAGADOS')
                    .setColor(0xFF0000)
                    .setDescription(
                        `**Resultado da operação:**\n\n` +
                        `✅ **Apagados com sucesso:** ${deletedProducts.length}\n` +
                        (errorProducts.length > 0 ? `❌ **Erros:** ${errorProducts.length}\n` : '')
                    );
                
                if (deletedProducts.length > 0) {
                    let deletedList = '';
                    deletedProducts.forEach((product, index) => {
                        deletedList += `${index + 1}. **${product.title}**\n`;
                        deletedList += `   • ID: \`${product.id}\`\n`;
                        deletedList += `   • Preço: ${formatPrice(product.price)}\n`;
                        deletedList += `   • Região: ${product.region === 'br' ? '🇧🇷 Brasil' : '🌍 Internacional'}\n\n`;
                    });
                    
                    embed.addFields({
                        name: '📦 Produtos Removidos',
                        value: deletedList || '*Nenhum*',
                        inline: false
                    });
                }
                
                if (errorProducts.length > 0) {
                    embed.addFields({
                        name: '⚠️ Produtos com Erro',
                        value: errorProducts.map(id => `\`${id.substring(0, 8)}...\``).join(', '),
                        inline: false
                    });
                }
                
                embed.setFooter({ 
                    text: `Total: ${selectedProductIds.length} produto(s) selecionado(s)` 
                }).setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                
                logger.info(`Produtos apagados por ${interaction.user.tag}`, {
                    adminId: interaction.user.id,
                    deleted: deletedProducts.length,
                    errors: errorProducts.length,
                    productIds: selectedProductIds
                });
            }

            // HANDLER PARA MENU DE SELEÇÃO DE EDITAR PRODUTO
            else if (interaction.customId === 'edit_product_select') {
                await interaction.deferReply({ ephemeral: true });
                
                if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.editReply('❌ Apenas administradores podem editar produtos.');
                }
                
                const productId = interaction.values[0];
                const product = productService.getProduct(productId);
                
                if (!product) {
                    return interaction.editReply('❌ Produto não encontrado.');
                }
                
                // Criar modal para edição
                const modal = new ModalBuilder()
                    .setCustomId('edit_product_modal_' + productId)
                    .setTitle('✏️ Editar: ' + product.title.substring(0, 45));
                
                // Campo: Título
                const titleInput = new TextInputBuilder()
                    .setCustomId('edit_title')
                    .setLabel('Título do Produto')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
                    .setValue(product.title);
                
                // Campo: Descrição
                const descriptionInput = new TextInputBuilder()
                    .setCustomId('edit_description')
                    .setLabel('Descrição (opcional)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(1000)
                    .setValue(product.description || '');
                
                // Campo: Preço
                const priceInput = new TextInputBuilder()
                    .setCustomId('edit_price')
                    .setLabel('Preço (ex: 99.90)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(10)
                    .setValue(product.price.toString());
                
                // Campo: Estoque
                const stockInput = new TextInputBuilder()
                    .setCustomId('edit_stock')
                    .setLabel('Estoque (deixe vazio para ilimitado)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(10)
                    .setValue(product.stock === null ? '' : product.stock.toString());
                
                // Campo: Imagem URL
                const imageInput = new TextInputBuilder()
                    .setCustomId('edit_image')
                    .setLabel('URL da Imagem (opcional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(500)
                    .setValue(product.image || '');
                
                // Adicionar campos ao modal (máximo 5 campos por modal)
                modal.addComponents(
                    new ActionRowBuilder().addComponents(titleInput),
                    new ActionRowBuilder().addComponents(descriptionInput),
                    new ActionRowBuilder().addComponents(priceInput),
                    new ActionRowBuilder().addComponents(stockInput),
                    new ActionRowBuilder().addComponents(imageInput)
                );
                
                await interaction.showModal(modal);
            }
        }

        // Lidar com modais
        else if (interaction.isModalSubmit()) {
            
            // MODAL DE CUPOM DO CARRINHO
            if (interaction.customId.startsWith('apply_coupon_')) {
                await interaction.deferReply({ ephemeral: true });
                
                const checkoutId = interaction.customId.replace('apply_coupon_', '');
                const couponCode = interaction.fields.getTextInputValue('coupon_code');
                
                const checkout = checkoutService.getCheckout(checkoutId);
                if (!checkout) {
                    return interaction.editReply('❌ Carrinho não encontrado.');
                }

                const product = productService.getProduct(checkout.productId);
                if (!product) {
                    return interaction.editReply('❌ Produto não encontrado.');
                }

                // Aplicar cupom
                const result = checkoutService.applyCoupon(
                    checkoutId,
                    couponCode,
                    interaction.user.id,
                    product.id,
                    product.region
                );

                if (result.success) {
                    const isBR = product.region === 'br';
                    await interaction.editReply(
                        isBR 
                        ? '✅ Cupom `' + couponCode + '` aplicado com sucesso!\n💰 **Desconto:** ' + formatPrice(result.discount) + '\n💵 **Novo total:** ' + formatPrice(result.checkout.total)
                        : '✅ Coupon `' + couponCode + '` applied successfully!\n💰 **Discount:** ' + formatPrice(result.discount) + '\n💵 **New total:** ' + formatPrice(result.checkout.total)
                    );
                    
                    // Atualizar painel do carrinho se estiver em um canal
                    try {
                        const cartService = new CartService(interaction.client);
                        await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                        
                        // Apagar mensagem antiga do carrinho
                        const messages = await interaction.channel.messages.fetch({ limit: 5 });
                        const cartMessages = messages.filter(msg => 
                            msg.embeds.length > 0 && 
                            (msg.embeds[0].title?.includes('Carrinho') || msg.embeds[0].title?.includes('Cart'))
                        );
                        
                        cartMessages.forEach(msg => {
                            if (msg.deletable) msg.delete().catch(() => {});
                        });
                    } catch (error) {
                        // Ignora erro se não estiver em canal de carrinho
                    }
                } else {
                    await interaction.editReply('❌ ' + result.error);
                }
            }
            
            // MODAL DE CUPOM DO PAINEL DO PRODUTO
            else if (interaction.customId.startsWith('apply_coupon_modal_')) {
                await interaction.deferReply({ ephemeral: true });
                
                const checkoutId = interaction.customId.replace('apply_coupon_modal_', '');
                const couponCode = interaction.fields.getTextInputValue('coupon_code_input');
                
                const checkout = checkoutService.getCheckout(checkoutId);
                if (!checkout) {
                    return interaction.editReply('❌ Carrinho não encontrado.');
                }

                const product = productService.getProduct(checkout.productId);
                if (!product) {
                    return interaction.editReply('❌ Produto não encontrado.');
                }

                // Aplicar cupom
                const result = checkoutService.applyCoupon(
                    checkoutId,
                    couponCode,
                    interaction.user.id,
                    product.id,
                    product.region
                );

                if (result.success) {
                    const isBR = product.region === 'br';
                    await interaction.editReply(
                        isBR 
                        ? '✅ Cupom `' + couponCode + '` aplicado com sucesso!\n💰 **Desconto:** ' + formatPrice(result.discount) + '\n💵 **Novo total:** ' + formatPrice(result.checkout.total)
                        : '✅ Coupon `' + couponCode + '` applied successfully!\n💰 **Discount:** ' + formatPrice(result.discount) + '\n💵 **New total:** ' + formatPrice(result.checkout.total)
                    );
                    
                    // Atualizar painel do carrinho se estiver em um canal
                    try {
                        const cartService = new CartService(interaction.client);
                        await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                        
                        // Apagar mensagem antiga do carrinho
                        const messages = await interaction.channel.messages.fetch({ limit: 5 });
                        const cartMessages = messages.filter(msg => 
                            msg.embeds.length > 0 && 
                            (msg.embeds[0].title?.includes('Carrinho') || msg.embeds[0].title?.includes('Cart'))
                        );
                        
                        cartMessages.forEach(msg => {
                            if (msg.deletable) msg.delete().catch(() => {});
                        });
                    } catch (error) {
                        // Ignora erro se não estiver em canal de carrinho
                    }
                } else {
                    await interaction.editReply('❌ ' + result.error);
                }
            }
            
            // MODAL DE EDIÇÃO DE PRODUTO
            else if (interaction.customId.startsWith('edit_product_modal_')) {
                await interaction.deferReply({ ephemeral: true });
                
                if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.editReply('❌ Apenas administradores podem editar produtos.');
                }
                
                const productId = interaction.customId.replace('edit_product_modal_', '');
                const product = productService.getProduct(productId);
                
                if (!product) {
                    return interaction.editReply('❌ Produto não encontrado.');
                }
                
                try {
                    // Obter valores do modal
                    const title = interaction.fields.getTextInputValue('edit_title');
                    const description = interaction.fields.getTextInputValue('edit_description') || '';
                    const price = parseFloat(interaction.fields.getTextInputValue('edit_price'));
                    const stockValue = interaction.fields.getTextInputValue('edit_stock');
                    const image = interaction.fields.getTextInputValue('edit_image') || '';
                    
                    // Validar preço
                    if (isNaN(price) || price < 0) {
                        return interaction.editReply('❌ Preço inválido. Use um número válido (ex: 99.90).');
                    }
                    
                    // Processar estoque (vazio = ilimitado)
                    let stock = null;
                    if (stockValue.trim() !== '') {
                        const stockNumber = parseInt(stockValue);
                        if (isNaN(stockNumber) || stockNumber < 0) {
                            return interaction.editReply('❌ Estoque inválido. Use um número inteiro ou deixe vazio para ilimitado.');
                        }
                        stock = stockNumber;
                    }
                    
                    // Atualizar produto
                    const updatedProduct = productService.updateProduct(productId, {
                        title: title,
                        description: description,
                        price: price,
                        stock: stock,
                        image: image
                    });
                    
                    if (updatedProduct) {
                        const embed = new EmbedBuilder()
                            .setTitle('✅ PRODUTO ATUALIZADO!')
                            .setColor(0x00FF00)
                            .setDescription(`O produto **${title}** foi atualizado com sucesso.`)
                            .addFields(
                                {
                                    name: '📦 Detalhes Atualizados',
                                    value: `• **Título:** ${title}\n• **Preço:** ${formatPrice(price)}\n• **Estoque:** ${stock === null ? '∞ Ilimitado' : stock}\n• **Imagem:** ${image ? 'Sim' : 'Não'}`,
                                    inline: false
                                },
                                {
                                    name: '🔧 Ações Recomendadas',
                                    value: 'Para que as mudanças apareçam no catálogo:\n1. Use `/republish-products` para republicar\n2. Ou aguarde a próxima republicação automática',
                                    inline: false
                                }
                            )
                            .setFooter({ text: 'ID: ' + productId })
                            .setTimestamp();
                        
                        await interaction.editReply({ embeds: [embed] });
                        
                        logger.info(`Produto editado por ${interaction.user.tag}`, {
                            adminId: interaction.user.id,
                            productId: productId,
                            title: title,
                            price: price,
                            stock: stock
                        });
                    } else {
                        await interaction.editReply('❌ Erro ao atualizar produto.');
                    }
                    
                } catch (error) {
                    logger.erro('EDITAR_PRODUTO_MODAL', error, interaction.user.id);
                    await interaction.editReply('❌ Erro ao processar edição do produto: ' + error.message);
                }
            }
        }
    }
};