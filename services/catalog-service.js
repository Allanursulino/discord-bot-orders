const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const productService = require('./product-service');
const config = require('../config.json');

class CatalogService {
    constructor(client) {
        this.client = client;
    }

    // Criar mensagem de produto específica para região
    createProductEmbed(product) {
        const regionInfo = productService.getProductRegionInfo(product.id);
        const regionEmoji = regionInfo.emojis?.flag || '📦';
        
        // Texto baseado na região
        const isInternational = product.region !== 'br';
        
        const title = `${regionEmoji} ${product.title}`;
        const description = product.description || (isInternational ? 'No description' : 'Sem descrição');
        
        const footerText = isInternational
            ? `Click BUY NOW to purchase • ${regionInfo.name}`
            : `Clique em COMPRAR para adquirir • ${regionInfo.name}`;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(this.getRegionColor(product.region))
            .addFields(
                {
                    name: isInternational ? '💵 PRICE' : '💰 PREÇO',
                    value: `${regionInfo.emojis?.currency || ''} ${product.price.toFixed(2)} ${product.currency}`,
                    inline: true
                },
                {
                    name: isInternational ? '📦 STOCK' : '📦 ESTOQUE',
                    value: product.stock === null ? 
                        (isInternational ? '∞ Unlimited' : '∞ Ilimitado') : 
                        (isInternational ? `${product.stock} units` : `${product.stock} unidades`),
                    inline: true
                },
                {
                    name: isInternational ? '🌍 REGION' : '🌍 REGIÃO',
                    value: regionInfo.name,
                    inline: true
                }
            )
            .setFooter({ 
                text: footerText
            })
            .setTimestamp();

        if (product.image) {
            embed.setImage(product.image);
        }

        // Botões com texto apropriado - AGORA COM 4 BOTÕES EM 2 LINHAS
        const buyButtonLabel = isInternational ? '🛒 BUY NOW' : '🛒 COMPRAR AGORA';
        const detailsButtonLabel = isInternational ? 'ℹ️ DETAILS' : 'ℹ️ DETALHES';
        const cancelButtonLabel = isInternational ? '❌ CANCEL PURCHASE' : '❌ CANCELAR COMPRA';
        const couponButtonLabel = isInternational ? '🎫 ADD COUPON' : '🎫 ADICIONAR CUPOM';

        // Linha 1: Ações principais
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy:${product.id}`)
                    .setLabel(buyButtonLabel)
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`details:${product.id}`)
                    .setLabel(detailsButtonLabel)
                    .setStyle(ButtonStyle.Secondary)
            );

        // Linha 2: Ações adicionais
        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`check_cancel:${product.id}`)
                    .setLabel(cancelButtonLabel)
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`check_coupon:${product.id}`)
                    .setLabel(couponButtonLabel)
                    .setStyle(ButtonStyle.Primary)
            );

        return { embeds: [embed], components: [row1, row2] };
    }

    // Cor baseada na região
    getRegionColor(region) {
        const colors = {
            'br': 0x009C3B, // Verde do Brasil
            'intl': 0x0052A5, // Azul internacional
            'us': 0x3C3B6E, // Azul dos EUA
            'eu': 0x003399 // Azul da UE
        };
        return colors[region] || 0x5865F2;
    }

    // Enviar produto para o canal correto baseado na região
    async publishProduct(productId, specificChannel = null) {
        try {
            const product = productService.getProduct(productId);
            if (!product) {
                console.log(`❌ Produto ${productId} não encontrado`);
                return false;
            }

            const regionInfo = config.regions[product.region];
            let channelId = specificChannel || regionInfo?.product_channel;

            if (!channelId) {
                console.log(`❌ Canal não configurado para região ${product.region}`);
                return false;
            }

            const channel = await this.client.channels.fetch(channelId);
            if (!channel) {
                console.log(`❌ Canal ${channelId} não encontrado`);
                return false;
            }

            const message = this.createProductEmbed(product);
            await channel.send(message);
            
            console.log(`✅ Produto "${product.title}" publicado no canal ${channel.name} (${regionInfo.name})`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao publicar produto:', error);
            return false;
        }
    }

    // Publicar produto em múltiplos canais (se necessário)
    async publishProductToMultiple(productId, channelIds) {
        const results = [];
        for (const channelId of channelIds) {
            const result = await this.publishProduct(productId, channelId);
            results.push({ channelId, success: result });
        }
        return results;
    }

    // Atualizar todos os produtos em seus respectivos canais
    async updateAllProducts() {
        try {
            const products = productService.getAllProducts();
            let successCount = 0;
            let errorCount = 0;
            
            for (const product of products) {
                try {
                    const success = await this.publishProduct(product.id);
                    if (success) {
                        successCount++;
                        console.log(`✅ Produto "${product.title}" republicado`);
                    } else {
                        errorCount++;
                        console.log(`❌ Erro ao republicar produto "${product.title}"`);
                    }
                } catch (productError) {
                    errorCount++;
                    console.error(`❌ Erro ao processar produto ${product.id}:`, productError.message);
                }
            }

            console.log(`✅ Catálogo atualizado: ${successCount} sucesso, ${errorCount} erros`);
            return { success: successCount, errors: errorCount, total: products.length };
        } catch (error) {
            console.error('❌ Erro ao atualizar catálogo:', error);
            return { success: 0, errors: 1, total: 0 };
        }
    }

    // Limpar todos os produtos dos canais antes de republicar
    async clearAllProducts() {
        try {
            const regions = Object.keys(config.regions || {});
            let clearedCount = 0;
            
            for (const region of regions) {
                const regionInfo = config.regions[region];
                const channelId = regionInfo?.product_channel;
                
                if (!channelId) continue;
                
                const channel = await this.client.channels.fetch(channelId);
                if (!channel) continue;
                
                try {
                    // Buscar mensagens do bot
                    const messages = await channel.messages.fetch({ limit: 50 });
                    const botMessages = messages.filter(msg => msg.author.id === this.client.user.id);
                    
                    // Deletar mensagens do bot
                    for (const message of botMessages.values()) {
                        try {
                            await message.delete();
                            clearedCount++;
                            await new Promise(resolve => setTimeout(resolve, 100)); // Pequeno delay para evitar rate limit
                        } catch (deleteError) {
                            console.error(`Erro ao deletar mensagem:`, deleteError.message);
                        }
                    }
                    
                    console.log(`✅ Canal ${channel.name} limpo: ${botMessages.size} mensagens removidas`);
                } catch (channelError) {
                    console.error(`❌ Erro ao limpar canal ${channelId}:`, channelError.message);
                }
            }
            
            return clearedCount;
        } catch (error) {
            console.error('❌ Erro ao limpar produtos:', error);
            return 0;
        }
    }

    // Republicar todos os produtos (limpa e republica)
    async republishAllProducts() {
        try {
            console.log('🔄 Iniciando republicação de produtos...');
            
            // Limpar produtos antigos
            console.log('🧹 Limpando produtos antigos...');
            const cleared = await this.clearAllProducts();
            console.log(`✅ ${cleared} mensagens antigas removidas`);
            
            // Republicar todos os produtos
            console.log('🔄 Republicando produtos com novos botões...');
            const result = await this.updateAllProducts();
            
            console.log(`✅ Republicação concluída!`);
            console.log(`📊 Resultado: ${result.success} sucesso, ${result.errors} erros de ${result.total} produtos`);
            
            return result;
        } catch (error) {
            console.error('❌ Erro ao republicar produtos:', error);
            return { success: 0, errors: 1, total: 0 };
        }
    }
}

module.exports = CatalogService;