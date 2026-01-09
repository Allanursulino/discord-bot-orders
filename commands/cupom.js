const {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle
} = require("discord.js");
const couponService = require("../services/coupon-service");
const { formatPrice } = require("../@shared");
const logger = require("../utils/logger");

module.exports = {
    options: {
        name: "cupom",
        type: ApplicationCommandType.ChatInput,
        description: "Gerenciar cupons de desconto",
        options: [
            {
                name: "acao",
                description: "Ação a ser realizada",
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: "➕ Criar cupom", value: "create" },
                    { name: "📋 Listar cupons", value: "list" },
                    { name: "🔍 Ver detalhes", value: "details" },
                    { name: "🗑️ Deletar cupom", value: "delete" },
                    { name: "📊 Estatísticas", value: "stats" }
                ]
            },
            {
                name: "codigo",
                description: "Código do cupom (para detalhes ou deletar)",
                type: ApplicationCommandOptionType.String,
                required: false,
            }
        ],
    },
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply("❌ Apenas administradores podem gerenciar cupons.");
        }

        const action = interaction.options.getString("acao");
        const codigo = interaction.options.getString("codigo");

        try {
            switch (action) {
                case 'create':
                    await this.createCoupon(interaction);
                    break;
                case 'list':
                    await this.listCoupons(interaction);
                    break;
                case 'details':
                    if (!codigo) {
                        return interaction.editReply("❌ Informe o código do cupom.");
                    }
                    await this.couponDetails(interaction, codigo);
                    break;
                case 'delete':
                    if (!codigo) {
                        return interaction.editReply("❌ Informe o código do cupom.");
                    }
                    await this.deleteCoupon(interaction, codigo);
                    break;
                case 'stats':
                    await this.couponStats(interaction);
                    break;
                default:
                    await interaction.editReply("❌ Ação inválida.");
            }
        } catch (error) {
            logger.erro('COMANDO_CUPOM', error, interaction.user.id);
            await interaction.editReply("❌ Ocorreu um erro ao processar o comando.");
        }
    },

    // Criar cupom
    async createCoupon(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('create_coupon_modal')
            .setTitle('Criar Cupom de Desconto');

        // Código do cupom
        const codeInput = new TextInputBuilder()
            .setCustomId('coupon_code')
            .setLabel('Código do Cupom (ou deixe vazio para gerar)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20)
            .setPlaceholder('Ex: PROMO20');

        // Tipo de desconto
        const typeInput = new TextInputBuilder()
            .setCustomId('coupon_type')
            .setLabel('Tipo (PERCENTAGE ou FIXED)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10)
            .setPlaceholder('PERCENTAGE ou FIXED');

        // Valor do desconto
        const amountInput = new TextInputBuilder()
            .setCustomId('coupon_amount')
            .setLabel('Valor do Desconto')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10)
            .setPlaceholder('Ex: 20 (para 20% ou R$ 20)');

        // Usos máximos
        const maxUsesInput = new TextInputBuilder()
            .setCustomId('coupon_max_uses')
            .setLabel('Usos Máximos (vazio = ilimitado)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10)
            .setPlaceholder('Ex: 100');

        // Valor mínimo
        const minPurchaseInput = new TextInputBuilder()
            .setCustomId('coupon_min_purchase')
            .setLabel('Valor Mínimo da Compra')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10)
            .setPlaceholder('Ex: 50.00');

        modal.addComponents(
            new ActionRowBuilder().addComponents(codeInput),
            new ActionRowBuilder().addComponents(typeInput),
            new ActionRowBuilder().addComponents(amountInput),
            new ActionRowBuilder().addComponents(maxUsesInput),
            new ActionRowBuilder().addComponents(minPurchaseInput)
        );

        await interaction.showModal(modal);

        const filter = (i) => i.customId === 'create_coupon_modal' && i.user.id === interaction.user.id;
        
        try {
            const modalResponse = await interaction.awaitModalSubmit({ filter, time: 300000 });
            
            await modalResponse.deferReply({ ephemeral: true });

            // Coletar dados
            let code = modalResponse.fields.getTextInputValue('coupon_code');
            const type = modalResponse.fields.getTextInputValue('coupon_type').toUpperCase();
            const amount = parseFloat(modalResponse.fields.getTextInputValue('coupon_amount'));
            const maxUses = modalResponse.fields.getTextInputValue('coupon_max_uses');
            const minPurchase = modalResponse.fields.getTextInputValue('coupon_min_purchase');

            // Validar tipo
            if (!['PERCENTAGE', 'FIXED'].includes(type)) {
                return modalResponse.editReply("❌ Tipo inválido. Use PERCENTAGE ou FIXED.");
            }

            // Validar valor
            if (isNaN(amount) || amount <= 0) {
                return modalResponse.editReply("❌ Valor do desconto inválido.");
            }

            // Gerar código se não fornecido
            if (!code || code.trim() === '') {
                code = couponService.generateUniqueCode(8);
            }

            // Verificar se código já existe
            if (couponService.codeExists(code)) {
                return modalResponse.editReply(`❌ O código ${code} já existe.`);
            }

            // Criar cupom
            const couponData = {
                code: code,
                type: type,
                amount: amount,
                max_uses: maxUses && maxUses.trim() !== '' ? parseInt(maxUses) : null,
                min_purchase: minPurchase && minPurchase.trim() !== '' ? parseFloat(minPurchase) : 0,
                created_by: interaction.user.id,
                created_at: new Date().toISOString()
            };

            const coupon = couponService.createCoupon(couponData);

            // Embed de confirmação
            const embed = new EmbedBuilder()
                .setTitle('✅ CUPOM CRIADO COM SUCESSO!')
                .setColor(0x00FF00)
                .addFields(
                    {
                        name: '🎫 Código',
                        value: `\`${coupon.code}\``,
                        inline: true
                    },
                    {
                        name: '💰 Tipo',
                        value: coupon.type === 'PERCENTAGE' ? 'Percentual' : 'Valor Fixo',
                        inline: true
                    },
                    {
                        name: '💵 Desconto',
                        value: coupon.type === 'PERCENTAGE' ? `${coupon.amount}%` : formatPrice(coupon.amount),
                        inline: true
                    },
                    {
                        name: '📊 Usos Máximos',
                        value: coupon.max_uses === null ? '∞ Ilimitado' : `${coupon.max_uses} vezes`,
                        inline: true
                    },
                    {
                        name: '💳 Valor Mínimo',
                        value: coupon.min_purchase > 0 ? formatPrice(coupon.min_purchase) : 'Sem mínimo',
                        inline: true
                    },
                    {
                        name: '👤 Criado por',
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: '📅 Criado em',
                        value: new Date(coupon.created_at).toLocaleString('pt-BR'),
                        inline: true
                    }
                )
                .setFooter({ text: 'Use /cupom list para ver todos os cupons' })
                .setTimestamp();

            await modalResponse.editReply({
                content: `✅ **Cupom criado!**`,
                embeds: [embed]
            });

            logger.info(`Cupom criado: ${coupon.code}`, {
                type: coupon.type,
                amount: coupon.amount,
                admin: interaction.user.tag
            });

        } catch (error) {
            if (error.name === 'InteractionCollectorError') {
                return;
            }
            logger.erro('CRIAR_CUPOM_MODAL', error, interaction.user.id);
        }
    },

    // Listar cupons
    async listCoupons(interaction) {
        const coupons = couponService.getAllCoupons();

        if (coupons.length === 0) {
            return interaction.editReply("📭 Nenhum cupom cadastrado.");
        }

        const embed = new EmbedBuilder()
            .setTitle('🎫 CUPONS DISPONÍVEIS')
            .setColor(0x5865F2)
            .setDescription(`**Total:** ${coupons.length} cupom(s)`)
            .setFooter({ text: 'Use /cupom details [código] para ver detalhes' })
            .setTimestamp();

        // Agrupar por status
        const now = new Date();
        const activeCoupons = [];
        const expiredCoupons = [];

        coupons.forEach(coupon => {
            let isExpired = false;
            if (coupon.valid_until) {
                isExpired = new Date(coupon.valid_until) < now;
            }
            
            if (isExpired) {
                expiredCoupons.push(coupon);
            } else {
                activeCoupons.push(coupon);
            }
        });

        // Cupons ativos
        if (activeCoupons.length > 0) {
            let activeText = '';
            activeCoupons.slice(0, 10).forEach(coupon => {
                const discount = coupon.type === 'PERCENTAGE' ? `${coupon.amount}%` : formatPrice(coupon.amount);
                const uses = coupon.max_uses === null ? '∞' : `${coupon.used_count}/${coupon.max_uses}`;
                activeText += `• \`${coupon.code}\` - ${discount} (${uses} usos)\n`;
            });

            if (activeCoupons.length > 10) {
                activeText += `\n... e mais ${activeCoupons.length - 10} cupons`;
            }

            embed.addFields({
                name: `✅ ATIVOS (${activeCoupons.length})`,
                value: activeText || '*Nenhum cupom ativo*',
                inline: false
            });
        }

        // Cupons expirados
        if (expiredCoupons.length > 0) {
            let expiredText = '';
            expiredCoupons.slice(0, 5).forEach(coupon => {
                expiredText += `• \`${coupon.code}\` - Expirado\n`;
            });

            if (expiredCoupons.length > 5) {
                expiredText += `\n... e mais ${expiredCoupons.length - 5} cupons expirados`;
            }

            embed.addFields({
                name: `❌ EXPIRADOS (${expiredCoupons.length})`,
                value: expiredText || '*Nenhum cupom expirado*',
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Detalhes do cupom
    async couponDetails(interaction, code) {
        const coupon = couponService.getCoupon(code);

        if (!coupon) {
            return interaction.editReply(`❌ Cupom \`${code}\` não encontrado.`);
        }

        const now = new Date();
        const validFrom = new Date(coupon.valid_from);
        const validUntil = coupon.valid_until ? new Date(coupon.valid_until) : null;
        
        const isActive = !validUntil || validUntil > now;
        const isExpired = validUntil && validUntil <= now;
        const notStarted = validFrom > now;

        let status = '✅ ATIVO';
        let statusColor = 0x00FF00;
        
        if (isExpired) {
            status = '❌ EXPIRADO';
            statusColor = 0xFF0000;
        } else if (notStarted) {
            status = '⏳ AGUARDANDO';
            statusColor = 0xFFA500;
        } else if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
            status = '🔒 ESGOTADO';
            statusColor = 0x808080;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🎫 CUPOM: ${coupon.code}`)
            .setColor(statusColor)
            .addFields(
                {
                    name: '📊 Status',
                    value: status,
                    inline: true
                },
                {
                    name: '💰 Tipo',
                    value: coupon.type === 'PERCENTAGE' ? 'Percentual' : 'Valor Fixo',
                    inline: true
                },
                {
                    name: '💵 Desconto',
                    value: coupon.type === 'PERCENTAGE' ? `${coupon.amount}%` : formatPrice(coupon.amount),
                    inline: true
                },
                {
                    name: '📈 Usos',
                    value: coupon.max_uses === null ? 
                        `${coupon.used_count} (∞ ilimitado)` : 
                        `${coupon.used_count}/${coupon.max_uses}`,
                    inline: true
                },
                {
                    name: '💳 Valor Mínimo',
                    value: coupon.min_purchase > 0 ? formatPrice(coupon.min_purchase) : 'Sem mínimo',
                    inline: true
                },
                {
                    name: '📅 Criado em',
                    value: new Date(coupon.created_at).toLocaleString('pt-BR'),
                    inline: true
                },
                {
                    name: '👤 Criado por',
                    value: `<@${coupon.created_by}>`,
                    inline: true
                }
            )
            .setFooter({ text: `ID: ${coupon.id}` })
            .setTimestamp();

        // Validade
        if (coupon.valid_until) {
            embed.addFields({
                name: '⏰ Válido até',
                value: validUntil.toLocaleString('pt-BR'),
                inline: true
            });
        }

        if (coupon.valid_from && validFrom > new Date('2020-01-01')) {
            embed.addFields({
                name: '⏰ Válido a partir de',
                value: validFrom.toLocaleString('pt-BR'),
                inline: true
            });
        }

        // Produtos específicos
        if (coupon.products && coupon.products.length > 0) {
            embed.addFields({
                name: '📦 Produtos Específicos',
                value: `Válido para ${coupon.products.length} produto(s) específico(s)`,
                inline: false
            });
        }

        // Regiões específicas
        if (coupon.regions && coupon.regions.length > 0) {
            embed.addFields({
                name: '🌍 Regiões',
                value: coupon.regions.join(', '),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Deletar cupom
    async deleteCoupon(interaction, code) {
        const coupon = couponService.getCoupon(code);

        if (!coupon) {
            return interaction.editReply(`❌ Cupom \`${code}\` não encontrado.`);
        }

        const deleted = couponService.deleteCoupon(code);
        
        if (deleted) {
            logger.info(`Cupom deletado: ${code}`, {
                deletedBy: interaction.user.tag,
                couponType: coupon.type,
                couponAmount: coupon.amount
            });

            const embed = new EmbedBuilder()
                .setTitle('🗑️ CUPOM DELETADO')
                .setColor(0xFF0000)
                .setDescription(`O cupom \`${code}\` foi deletado permanentemente.`)
                .addFields(
                    {
                        name: '💰 Tipo',
                        value: coupon.type === 'PERCENTAGE' ? 'Percentual' : 'Valor Fixo',
                        inline: true
                    },
                    {
                        name: '💵 Desconto',
                        value: coupon.type === 'PERCENTAGE' ? `${coupon.amount}%` : formatPrice(coupon.amount),
                        inline: true
                    },
                    {
                        name: '📈 Usos Totais',
                        value: `${coupon.used_count} vez(es)`,
                        inline: true
                    },
                    {
                        name: '👤 Deletado por',
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply(`❌ Erro ao deletar cupom \`${code}\`.`);
        }
    },

    // Estatísticas
    async couponStats(interaction) {
        const stats = couponService.getStatistics();

        const embed = new EmbedBuilder()
            .setTitle('📊 ESTATÍSTICAS DE CUPONS')
            .setColor(0x5865F2)
            .addFields(
                {
                    name: '📈 Total de Cupons',
                    value: `**${stats.total}** cupons`,
                    inline: true
                },
                {
                    name: '✅ Ativos',
                    value: `**${stats.active}** cupons`,
                    inline: true
                },
                {
                    name: '❌ Expirados',
                    value: `**${stats.expired}** cupons`,
                    inline: true
                },
                {
                    name: '💰 Cupons Percentuais',
                    value: `**${stats.percentage_coupons}** cupons`,
                    inline: true
                },
                {
                    name: '💵 Cupons de Valor Fixo',
                    value: `**${stats.fixed_coupons}** cupons`,
                    inline: true
                },
                {
                    name: '🎯 Usos Totais',
                    value: `**${stats.total_uses}** vezes`,
                    inline: true
                }
            )
            .setFooter({ text: 'Dados atualizados em tempo real' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};