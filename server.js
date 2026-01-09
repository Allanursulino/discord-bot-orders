const express = require('express');
const bodyParser = require('body-parser');
const paymentService = require('./services/payment-service');
const checkoutService = require('./services/checkout-service');
const logger = require('./utils/logger');
const webhookHandler = require('./events/webhook-handler');
const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
        req.rawBuffer = buf;
    }
}));

// Middleware para logging
app.use((req, res, next) => {
    logger.info(`[WEBHOOK] ${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// Rota de saúde
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'Discord Bot Webhook Server',
        version: '2.0',
        timestamp: new Date().toISOString(),
        features: {
            mercado_pago: 'active',
            stripe: 'active',
            webhooks: 'enabled'
        }
    });
});

// Rota de status do sistema
app.get('/status', (req, res) => {
    const checkouts = checkoutService.getAllCheckouts();
    const pending = checkouts.filter(c => c.status === 'PENDING').length;
    const approved = checkouts.filter(c => c.status === 'APPROVED').length;
    
    res.json({
        status: 'operational',
        uptime: process.uptime(),
        checkouts: {
            total: checkouts.length,
            pending: pending,
            approved: approved,
            failed: checkouts.filter(c => c.status === 'FAILED').length
        },
        payment_providers: {
            mercado_pago: 'active',
            stripe: 'active'
        },
        environment: config.payment.mercadoPago.environment || 'production'
    });
});

// ========== WEBHOOK MERCADO PAGO ========== //

app.post('/webhook/mercado-pago', async (req, res) => {
    try {
        const payload = req.body;
        const headers = req.headers;
        
        logger.info('📥 Webhook Mercado Pago recebido', {
            type: payload.type,
            id: payload.id,
            action: payload.action
        });
        
        // Verificar se é um evento de pagamento
        if (payload.type !== 'payment') {
            logger.info('Evento ignorado (não é payment)', { type: payload.type });
            return res.status(200).json({ received: true, ignored: true });
        }
        
        // Processar com o payment service
        const result = await paymentService.handleMercadoPagoWebhook(payload);
        
        if (!result.success) {
            logger.erro('Webhook Mercado Pago falhou', new Error(result.error));
            return res.status(400).json({ 
                received: true, 
                processed: false, 
                error: result.error 
            });
        }
        
        // Se o pagamento foi aprovado
        if (result.status === 'approved' && result.checkoutId) {
            try {
                const checkout = await checkoutService.checkPaymentStatus(result.checkoutId);
                
                if (checkout && checkout.status === 'APPROVED') {
                    // Enviar notificação de venda
                    await webhookHandler.sendSaleNotification({
                        userId: checkout.userId,
                        username: `Discord User ${checkout.userId}`,
                        productName: checkout.productName || 'Produto Digital',
                        amount: result.amount || checkout.total,
                        paymentMethod: 'pix',
                        checkoutId: checkout.id,
                        provider: 'Mercado Pago PIX'
                    });
                    
                    logger.info('✅ Venda processada via webhook Mercado Pago', {
                        checkoutId: checkout.id,
                        userId: checkout.userId,
                        amount: checkout.total
                    });
                }
            } catch (checkoutError) {
                logger.erro('Erro ao processar checkout do webhook', checkoutError);
            }
        }
        
        logger.info('✅ Webhook Mercado Pago processado com sucesso', {
            event: result.event,
            status: result.status,
            checkoutId: result.checkoutId
        });
        
        res.status(200).json({ 
            received: true, 
            processed: true,
            event: result.event
        });
        
    } catch (error) {
        logger.erro('ERRO_WEBHOOK_MERCADO_PAGO', error);
        
        // Enviar erro para o admin
        await webhookHandler.sendErrorLog({
            context: 'Webhook Mercado Pago',
            error: error.message,
            userId: null,
            extra: {
                url: req.url,
                method: req.method
            }
        });
        
        res.status(500).json({ 
            received: true, 
            processed: false, 
            error: 'Internal server error' 
        });
    }
});

// ========== WEBHOOK STRIPE ========== //

app.post('/webhook/stripe', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    try {
        const result = await paymentService.handleStripeWebhook(req.rawBuffer, sig);
        
        logger.info('📥 Webhook Stripe recebido', {
            event: result.event,
            checkoutId: result.checkoutId
        });
        
        // Se foi um pagamento bem-sucedido, atualizar checkout
        if (result.event === 'payment_succeeded' && result.checkoutId) {
            const checkout = await checkoutService.checkPaymentStatus(result.checkoutId);
            
            if (checkout && checkout.status === 'APPROVED') {
                // Enviar notificação de venda
                await webhookHandler.sendSaleNotification({
                    userId: checkout.userId,
                    username: `Cliente Stripe ${checkout.userId}`,
                    productName: checkout.productName || 'Produto Stripe',
                    amount: checkout.total,
                    paymentMethod: 'stripe',
                    checkoutId: checkout.id,
                    provider: 'Stripe'
                });
                
                logger.info('✅ Venda processada via webhook Stripe', {
                    checkoutId: checkout.id,
                    userId: checkout.userId,
                    amount: checkout.total
                });
            }
        }
        
        res.json({ received: true });
    } catch (error) {
        logger.erro('ERRO_WEBHOOK_STRIPE_ROTA', error);
        
        // Enviar erro para o admin
        await webhookHandler.sendErrorLog({
            context: 'Webhook Stripe',
            error: error.message,
            userId: null
        });
        
        res.status(400).json({ error: error.message });
    }
});

// ========== ROTA PARA TESTE DE PIX ========== //

app.post('/test/pix', async (req, res) => {
    try {
        const { amount, checkoutId, userId } = req.body;
        
        if (!amount || !checkoutId || !userId) {
            return res.status(400).json({
                success: false,
                error: 'amount, checkoutId e userId são obrigatórios'
            });
        }
        
        // Gerar PIX de teste
        const pixResult = await paymentService.createMercadoPagoPixPayment(
            amount,
            'Teste PIX',
            checkoutId,
            userId
        );
        
        res.json({
            success: true,
            data: {
                qr_code_base64: pixResult.qr_code,
                qr_code_text: pixResult.qr_code_text,
                pix_code: pixResult.pix_code,
                payment_id: pixResult.payment_id,
                expires_at: pixResult.expires_at
            }
        });
        
    } catch (error) {
        logger.erro('TEST_PIX_ERROR', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== ROTA PARA VERIFICAR PAGAMENTO ========== //

app.get('/payment/:paymentId/status', async (req, res) => {
    try {
        const { paymentId } = req.params;
        const provider = req.query.provider || 'mercado_pago';
        
        if (!paymentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentId é obrigatório'
            });
        }
        
        let status;
        if (provider === 'mercado_pago') {
            status = await paymentService.checkMercadoPagoPayment(paymentId);
        } else {
            status = await paymentService.checkStripePayment(paymentId);
        }
        
        res.json({
            success: true,
            payment_id: paymentId,
            provider: provider,
            status: status.status,
            original_status: status.original_status,
            amount: status.amount,
            paid_at: status.paid_at,
            external_reference: status.external_reference
        });
        
    } catch (error) {
        logger.erro('CHECK_PAYMENT_STATUS_ERROR', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== ROTA PARA CHECKOUT ========== //

app.get('/checkout/:checkoutId', (req, res) => {
    try {
        const checkout = checkoutService.getCheckout(req.params.checkoutId);
        
        if (checkout) {
            // Ocultar dados sensíveis
            const safeCheckout = { ...checkout };
            if (safeCheckout.payment?.data?.raw_response) {
                delete safeCheckout.payment.data.raw_response;
            }
            
            res.json({
                success: true,
                checkout: safeCheckout
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Checkout não encontrado'
            });
        }
    } catch (error) {
        logger.erro('GET_CHECKOUT_ERROR', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== ROTA DE DEBUG ========== //

app.post('/debug/webhook', async (req, res) => {
    try {
        // Rota para simular webhooks (apenas desenvolvimento)
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({
                success: false,
                error: 'Apenas em ambiente de desenvolvimento'
            });
        }
        
        const { provider, event, data } = req.body;
        
        let result;
        if (provider === 'mercado_pago') {
            result = await webhookHandler.handleWebhook('mercado_pago', data);
        } else if (provider === 'stripe') {
            result = await webhookHandler.handleWebhook('stripe', data);
        } else {
            return res.status(400).json({
                success: false,
                error: 'Provider deve ser "mercado_pago" ou "stripe"'
            });
        }
        
        res.json({
            success: true,
            result: result
        });
        
    } catch (error) {
        logger.erro('DEBUG_WEBHOOK_ERROR', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== TRATAMENTO DE ERROS GLOBAIS ========== //

// 404 - Rota não encontrada
app.use((req, res) => {
    logger.info(`Rota não encontrada: ${req.method} ${req.url}`);
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada'
    });
});

// Error handler
app.use((error, req, res, next) => {
    logger.erro('EXPRESS_ERROR_HANDLER', error);
    
    res.status(error.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno do servidor',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});

// ========== INICIAR SERVIDOR ========== //

const server = app.listen(PORT, () => {
    console.log(`\n🚀 =========================================`);
    console.log(`🚀 WEBHOOK SERVER INICIADO COM SUCESSO!`);
    console.log(`🚀 =========================================`);
    console.log(`📌 Porta: ${PORT}`);
    console.log(`📌 Ambiente: ${config.payment.mercadoPago.environment || 'production'}`);
    console.log(`📌 Timestamp: ${new Date().toISOString()}`);
    console.log(`\n🌐 ========== WEBHOOK ENDPOINTS ==========`);
    console.log(`🌐 Mercado Pago: https://seu-dominio.com/webhook/mercado-pago`);
    console.log(`🌐 Stripe: https://seu-dominio.com/webhook/stripe`);
    console.log(`🌐 Status: https://seu-dominio.com/status`);
    console.log(`🌐 Health Check: https://seu-dominio.com/`);
    console.log(`\n🔧 ========== CONFIGURAÇÕES ==========`);
    console.log(`🔧 Access Token MP: ${config.payment.mercadoPago.access_token ? '✅ Configurado' : '❌ Não configurado'}`);
    console.log(`🔧 Webhook URL: ${config.payment.mercadoPago.webhook_url || '❌ Não configurado'}`);
    console.log(`🔧 Stripe: ${config.payment.stripe.secret_key ? '✅ Configurado' : '❌ Não configurado'}`);
    console.log(`🚀 =========================================\n`);
    
    logger.info(`Webhook Server iniciado na porta ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM recebido, encerrando servidor...');
    server.close(() => {
        logger.info('Servidor encerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT recebido, encerrando servidor...');
    server.close(() => {
        logger.info('Servidor encerrado');
        process.exit(0);
    });
});

// Tratamento de erros globais
process.on('unhandledRejection', (error) => {
    logger.erro('UNHANDLED_REJECTION', error);
    
    // Não sair em produção, apenas logar
    if (process.env.NODE_ENV === 'development') {
        throw error;
    }
});

process.on('uncaughtException', (error) => {
    logger.erro('UNCAUGHT_EXCEPTION', error);
    
    // Em produção, logar e continuar
    if (process.env.NODE_ENV === 'production') {
        console.error('Uncaught Exception:', error);
    } else {
        process.exit(1);
    }
});

// Exportar para testes
module.exports = app;