require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, Events, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const config = require("./config.json");
const fg = require("fast-glob");
const logger = require("./utils/logger");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
    ],
});

// Aumentar limite de listeners
client.setMaxListeners(20);

const commandContainer = new Map();

// Carregar comandos
console.log('📁 Carregando comandos...');
fg.sync("commands/**/*.js").forEach((file) => {
    try {
        const command = require(`./${file}`);
        commandContainer.set(command.options.name, command);
        console.log(`✅ ${command.options.name}`);
    } catch (error) {
        console.error(`❌ Erro ao carregar ${file}:`, error.message);
    }
});

// Carregar eventos - EVITAR DUPLICATAS
console.log('\n📁 Carregando eventos...');
const loadedEvents = new Set();
fg.sync("events/**/*.js").forEach((file) => {
    try {
        // Evitar carregar interactionCreate múltiplas vezes
        if (file.includes('interaction-handler')) {
            // Carregar apenas UMA vez
            if (!loadedEvents.has('interaction-handler')) {
                const event = require(`./${file}`);
                if (event.type === Events.InteractionCreate) {
                    client.on(event.type, (...args) => event.execute(...args, client));
                    console.log(`✅ ${event.type} (from ${file})`);
                    loadedEvents.add('interaction-handler');
                }
            }
        } else {
            const event = require(`./${file}`);
            // Verificar se o evento já foi carregado
            if (!loadedEvents.has(event.type)) {
                if (event.type === Events.InteractionCreate) {
                    client.on(event.type, (...args) => event.execute(...args, client));
                } else if (event.execute && event.execute.length === 2) {
                    client.on(event.type, (...args) => event.execute(...args, client));
                } else {
                    client.on(event.type, (...args) => event.execute(...args));
                }
                console.log(`✅ ${event.type || file}`);
                loadedEvents.add(event.type);
            }
        }
    } catch (error) {
        console.error(`❌ Erro ao carregar ${file}:`, error.message);
    }
});

// Carregar workers
console.log('\n📁 Carregando workers...');
fg.sync("workers/**/*.js").forEach((file) => {
    try {
        const worker = require(`./${file}`);
        // Verificar se worker tem método execute
        if (worker.execute) {
            worker.execute(client);
            console.log(`✅ ${file}`);
        } else {
            console.error(`❌ ${file} não tem método execute`);
        }
    } catch (error) {
        console.error(`❌ Erro ao carregar ${file}:`, error.message);
        console.error('Stack:', error.stack);
    }
});

// Handler de comandos slash - APENAS UM
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandContainer.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.erro(`COMANDO ${interaction.commandName}`, error, interaction.user.id);
        
        const replyOptions = {
            content: "❌ Ocorreu um erro ao executar este comando.",
            ephemeral: true
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    }
});

// Quando o bot estiver pronto
client.once(Events.ClientReady, async () => {
    console.log(`\n✅ Bot conectado como: ${client.user.tag}`);
    console.log(`🔑 ID: ${client.user.id}`);
    console.log(`🌐 Servidores: ${client.guilds.cache.size}`);
    
    // Registrar comandos
    try {
        const commandsArray = Array.from(commandContainer.values()).map(cmd => cmd.options);
        
        // Adicionar comandos administrativos
        const adminCommands = [
            new SlashCommandBuilder()
                .setName('republish-products')
                .setDescription('Republicar todos os produtos com novos botões')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            
            new SlashCommandBuilder()
                .setName('cleanup-channels')
                .setDescription('Limpar canais de checkout abandonados')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            
            new SlashCommandBuilder()
                .setName('bot-status')
                .setDescription('Verificar status do bot e estatísticas')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
        
        // Converter para JSON e adicionar à lista
        adminCommands.forEach(cmd => {
            commandsArray.push(cmd.toJSON());
        });
        
        await client.application.commands.set(commandsArray);
        console.log(`📝 ${commandsArray.length} comandos registrados`);
    } catch (error) {
        console.error("❌ Erro ao registrar comandos:", error.message);
    }

    // Configurar status
    client.user.setPresence({
        activities: [{ 
            name: `🛒 Compre com PIX & Cartão`, 
            type: ActivityType.Playing 
        }],
        status: 'online'
    });

    logger.info(`Bot iniciado: ${client.user.tag}`);
});

// Login
console.log('\n🔗 Conectando ao Discord...');
client.login(config.token).catch(error => {
    console.error('❌ ERRO NO LOGIN:', error.message);
    
    if (error.message.includes("token")) {
        console.error('\⚠️ TOKEN INVÁLIDO!');
        console.error('Verifique o token no config.json');
    }
    
    process.exit(1);
});

// Handler para comandos administrativos
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    // Comando: /republish-products
    if (interaction.commandName === 'republish-products') {
        await interaction.deferReply({ ephemeral: true });
        
        // Verificar permissões de administrador
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('❌ Apenas administradores podem usar este comando.');
        }
        
        try {
            const CatalogService = require('./services/catalog-service');
            const catalogService = new CatalogService(client);
            
            await interaction.editReply('🔄 Republicando produtos com novos botões...\n\n**Isso pode levar alguns minutos...**');
            
            const result = await catalogService.republishAllProducts();
            
            const embed = new EmbedBuilder()
                .setTitle('✅ PRODUTOS REPUBLICADOS!')
                .setColor(0x00FF00)
                .setDescription('Todos os produtos foram republicados com os novos botões.')
                .addFields(
                    {
                        name: '📊 Resultado',
                        value: `✅ **Sucesso:** ${result.success} produtos\n❌ **Erros:** ${result.errors} produtos\n📦 **Total:** ${result.total} produtos`,
                        inline: false
                    },
                    {
                        name: '🎯 Novos Botões',
                        value: '• 🛒 COMPRAR AGORA / BUY NOW\n• ℹ️ DETALHES / DETAILS\n• ❌ CANCELAR COMPRA / CANCEL PURCHASE\n• 🎫 ADICIONAR CUPOM / ADD COUPON',
                        inline: false
                    }
                )
                .setFooter({ text: 'Os produtos agora estão disponíveis nos canais apropriados' })
                .setTimestamp();
            
            await interaction.editReply({ 
                content: null,
                embeds: [embed] 
            });
            
            logger.info(`Produtos republicados por ${interaction.user.tag}`, {
                adminId: interaction.user.id,
                success: result.success,
                errors: result.errors,
                total: result.total
            });
            
        } catch (error) {
            logger.erro('REPUBLISH_PRODUCTS', error, interaction.user.id);
            await interaction.editReply(`❌ Erro ao republicar produtos: ${error.message}`);
        }
    }
    
    // Comando: /cleanup-channels
    else if (interaction.commandName === 'cleanup-channels') {
        await interaction.deferReply({ ephemeral: true });
        
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('❌ Apenas administradores podem usar este comando.');
        }
        
        try {
            const CartService = require('./services/cart-service');
            const cartService = new CartService(client);
            
            await interaction.editReply('🧹 Limpando canais de checkout abandonados...');
            
            const cleaned = await cartService.cleanupAbandonedCarts();
            
            const embed = new EmbedBuilder()
                .setTitle('🧹 LIMPEZA CONCLUÍDA')
                .setColor(0x00FF00)
                .setDescription('Canais de checkout abandonados foram limpos.')
                .addFields(
                    {
                        name: '📊 Resultado',
                        value: `• 🗑️ **Canais limpos:** ${cleaned}\n• ⏰ **Critério:** Mais de 1 hora sem atividade\n• 🛒 **Status:** Carrinhos DRAFT cancelados`,
                        inline: false
                    }
                )
                .setFooter({ text: 'A limpeza automática ocorre periodicamente' })
                .setTimestamp();
            
            await interaction.editReply({ 
                content: null,
                embeds: [embed] 
            });
            
            logger.info(`Canais limpos por ${interaction.user.tag}`, {
                adminId: interaction.user.id,
                cleaned: cleaned
            });
            
        } catch (error) {
            logger.erro('CLEANUP_CHANNELS', error, interaction.user.id);
            await interaction.editReply(`❌ Erro ao limpar canais: ${error.message}`);
        }
    }
    
    // Comando: /bot-status
    else if (interaction.commandName === 'bot-status') {
        await interaction.deferReply({ ephemeral: true });
        
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('❌ Apenas administradores podem usar este comando.');
        }
        
        try {
            const productService = require('./services/product-service');
            const checkoutService = require('./services/checkout-service');
            const CartService = require('./services/cart-service');
            
            const cartService = new CartService(client);
            const products = productService.getAllProducts();
            const checkouts = checkoutService.getAllCheckouts();
            
            // Contar checkouts por status
            const draftCheckouts = checkouts.filter(c => c.status === 'DRAFT').length;
            const pendingCheckouts = checkouts.filter(c => c.status === 'PENDING').length;
            const approvedCheckouts = checkouts.filter(c => c.status === 'APPROVED').length;
            const completedCheckouts = checkouts.filter(c => c.status === 'COMPLETED').length;
            const cancelledCheckouts = checkouts.filter(c => c.status === 'CANCELLED').length;
            
            // Contar produtos por região
            const brProducts = products.filter(p => p.region === 'br').length;
            const intlProducts = products.filter(p => p.region === 'intl').length;
            
            // Estatísticas do servidor
            const guild = interaction.guild;
            const channelCount = guild.channels.cache.size;
            const memberCount = guild.memberCount;
            
            const embed = new EmbedBuilder()
                .setTitle('🤖 STATUS DO BOT')
                .setColor(0x5865F2)
                .setDescription(`**Bot:** ${client.user.tag}\n**Servidor:** ${guild.name}`)
                .addFields(
                    {
                        name: '📦 Produtos',
                        value: `• **Total:** ${products.length}\n• 🇧🇷 **Brasil:** ${brProducts}\n• 🌍 **Internacional:** ${intlProducts}`,
                        inline: true
                    },
                    {
                        name: '🛒 Checkouts',
                        value: `• **Total:** ${checkouts.length}\n• 📝 **Rascunho:** ${draftCheckouts}\n• ⏳ **Pendente:** ${pendingCheckouts}`,
                        inline: true
                    },
                    {
                        name: '✅ Checkouts (cont.)',
                        value: `• ✅ **Aprovado:** ${approvedCheckouts}\n• 🎉 **Completado:** ${completedCheckouts}\n• ❌ **Cancelado:** ${cancelledCheckouts}`,
                        inline: true
                    },
                    {
                        name: '🌐 Servidor',
                        value: `• 👥 **Membros:** ${memberCount}\n• 📁 **Canais:** ${channelCount}\n• 🏠 **ID:** ${guild.id}`,
                        inline: true
                    },
                    {
                        name: '⚙️ Sistema',
                        value: `• 🚀 **Uptime:** ${Math.floor(process.uptime() / 60)} minutos\n• 📊 **Memória:** ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n• 🖥️ **Node:** ${process.version}`,
                        inline: true
                    }
                )
                .setFooter({ text: 'Status atualizado em tempo real' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            logger.erro('BOT_STATUS', error, interaction.user.id);
            await interaction.editReply(`❌ Erro ao verificar status: ${error.message}`);
        }
    }
});

// Exportar para uso em outros arquivos
module.exports = { client };