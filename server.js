const express = require('express');
const bodyParser = require('body-parser');
const paymentService = require('./services/payment-service');
const checkoutService = require('./services/checkout-service');
const logger = require('./utils/logger');
const webhookHandler = require('./events/webhook-handler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// Rota de saúde
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'Discord Bot Webhook Server',
        timestamp: new Date().toISOString()
    });
});

// Webhook do Stripe
app.post('/webhook/stripe', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    try {
        const result = await paymentService.handleStripeWebhook(req.rawBody, sig);
        
        // Se foi um pagamento bem-sucedido, atualizar checkout
        if (result.event === 'payment_succeeded' && result.checkoutId) {
            const checkout = await checkoutService.checkPaymentStatus(result.checkoutId);
            
            if (checkout && checkout.status === 'APPROVED') {
                // Enviar notificação de venda
                webhookHandler.sendSaleNotification({
                    userId: checkout.userId,
                    username: 'Cliente Stripe',
                    productName: 'Produto Stripe',
                    amount: checkout.total,
                    paymentMethod: 'stripe',
                    checkoutId: checkout.id
                });
            }
        }
        
        res.json({ received: true });
    } catch (error) {
        logger.erro('WEBHOOK_STRIPE_ROTA', error);
        res.status(400).json({ error: error.message });
    }
});

// Webhook do SumUp (simplificado)
app.post('/webhook/sumup', async (req, res) => {
    try {
        const event = req.body;
        
        if (event.event_type === 'checkout.completed') {
            const checkoutId = event.checkout_reference;
            
            if (checkoutId) {
                const checkout = await checkoutService.checkPaymentStatus(checkoutId);
                
                if (checkout && checkout.status === 'APPROVED') {
                    // Enviar notificação de venda
                    webhookHandler.sendSaleNotification({
                        userId: checkout.userId,
                        username: 'Cliente PIX',
                        productName: 'Produto PIX',
                        amount: checkout.total,
                        paymentMethod: 'pix',
                        checkoutId: checkout.id
                    });
                }
            }
        }
        
        res.json({ received: true });
    } catch (error) {
        logger.erro('WEBHOOK_SUMUP_ROTA', error);
        res.status(400).json({ error: error.message });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Webhook Server rodando na porta ${PORT}`);
    console.log(`🌐 Stripe Webhook: http://seu-dominio.com/webhook/stripe`);
    console.log(`🌐 SumUp Webhook: http://seu-dominio.com/webhook/sumup`);
});

// Tratamento de erros
process.on('unhandledRejection', (error) => {
    logger.erro('UNHANDLED_REJECTION', error);
});

process.on('uncaughtException', (error) => {
    logger.erro('UNCAUGHT_EXCEPTION', error);
});