const { Events } = require('discord.js');
const productService = require('../services/product-service');
const checkoutService = require('../services/checkout-service');
const CartService = require('../services/cart-service');
const logger = require('../utils/logger');

module.exports = {
    type: Events.InteractionCreate,
    
    async execute(interaction, client) {
        // Só processa botões e menus
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

        const cartService = new CartService(client);
        
        try {
            // 🛒 BOTÃO "COMPRAR" NO CATÁLOGO
            if (interaction.customId?.startsWith('buy:')) {
                await interaction.deferReply({ ephemeral: true });
                
                const productId = interaction.customId.split(':')[1];
                const product = productService.getProduct(productId);
                
                if (!product) {
                    return interaction.editReply('❌ Produto não encontrado.');
                }

                // Criar checkout
                const checkout = checkoutService.createCheckout(
                    interaction.user.id,
                    productId,
                    1
                );

                if (!checkout) {
                    return interaction.editReply('❌ Erro ao criar carrinho. Estoque insuficiente.');
                }

                // Criar canal de checkout
                const channel = await cartService.createCheckoutChannel(interaction.user, checkout.id);
                
                if (!channel) {
                    return interaction.editReply('❌ Erro ao criar canal de checkout. Contate um administrador.');
                }

                // Enviar painel do carrinho
                await cartService.sendCartPanel(channel, checkout.id, interaction.user.id);
                
                await interaction.editReply(`✅ Carrinho criado! Acesse: ${channel}`);
            }

            // 💰 BOTÃO "PAGAR COM PIX"
            else if (interaction.customId?.startsWith('pay_pix:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                await cartService.sendPixPayment(interaction.channel, checkoutId, interaction.user.id);
            }

            // 💳 BOTÃO "PAGAR COM CARTÃO"
            else if (interaction.customId?.startsWith('pay_card:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                await cartService.sendStripePayment(interaction.channel, checkoutId, interaction.user.id);
            }

            // ✅ BOTÃO "JÁ PAGUEI"
            else if (interaction.customId?.startsWith('check_payment:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                await cartService.sendPaymentConfirmation(interaction.channel, checkoutId, interaction.user.id);
            }

            // ➕ BOTÃO "AUMENTAR QUANTIDADE"
            else if (interaction.customId?.startsWith('increase:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                const checkout = checkoutService.getCheckout(checkoutId);
                
                if (checkout) {
                    const updated = checkoutService.updateQuantity(checkoutId, checkout.quantity + 1);
                    if (updated) {
                        await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                        // Remove mensagem antiga
                        await interaction.message.delete().catch(() => {});
                    }
                }
            }

            // ➖ BOTÃO "DIMINUIR QUANTIDADE"
            else if (interaction.customId?.startsWith('decrease:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                const checkout = checkoutService.getCheckout(checkoutId);
                
                if (checkout && checkout.quantity > 1) {
                    const updated = checkoutService.updateQuantity(checkoutId, checkout.quantity - 1);
                    if (updated) {
                        await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                        await interaction.message.delete().catch(() => {});
                    }
                }
            }

            // ❌ BOTÃO "CANCELAR"
            else if (interaction.customId?.startsWith('cancel:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                checkoutService.cancelCheckout(checkoutId);
                
                await interaction.channel.send('❌ Compra cancelada. Este canal será deletado em breve.');
                await cartService.closeCheckoutChannel(checkoutId);
            }

            // ↩️ BOTÃO "VOLTAR"
            else if (interaction.customId?.startsWith('back_to_cart:')) {
                await interaction.deferUpdate();
                
                const checkoutId = interaction.customId.split(':')[1];
                await cartService.sendCartPanel(interaction.channel, checkoutId, interaction.user.id);
                await interaction.message.delete().catch(() => {});
            }

        } catch (error) {
            logger.erro('INTERACTION_HANDLER', error, interaction.user.id);
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('❌ Ocorreu um erro. Tente novamente.');
            } else {
                await interaction.reply({
                    content: '❌ Ocorreu um erro. Tente novamente.',
                    ephemeral: true
                });
            }
        }
    }
};