#!/usr/bin/env node
// =====================================================
// Script de verificación del Email Service
// Uso: node verify-email-service.js
// =====================================================

require('dotenv').config();
const nodemailer = require('nodemailer');
const chalk = require('chalk') || { green: (t) => t, red: (t) => t, yellow: (t) => t, blue: (t) => t };

const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE_RAW = process.env.SMTP_SECURE;
const SMTP_SECURE = SMTP_SECURE_RAW !== undefined
    ? String(SMTP_SECURE_RAW).toLowerCase() === 'true'
    : SMTP_PORT === 465;

const config = {
    SMTP_HOST: process.env.SMTP_HOST || '',
    SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    SMTP_SECURE,
    SMTP_REQUIRE_TLS: String(process.env.SMTP_REQUIRE_TLS || 'false').toLowerCase() === 'true',
    SMTP_VERIFY_TIMEOUT: Number(process.env.SMTP_VERIFY_TIMEOUT || 15000),
    NODE_ENV: process.env.NODE_ENV || 'development'
};

console.log('\n' + '='.repeat(60));
console.log('Email Service Verification');
console.log('='.repeat(60) + '\n');

// Mostrar configuración
console.log('📋 Configuration:');
console.log(`   Host: ${config.SMTP_HOST || '(no configurado)'}`);
console.log(`   Port: ${config.SMTP_PORT}`);
console.log(`   User: ${config.SMTP_USER || '(no configurado)'}`);
console.log(`   Secure: ${config.SMTP_SECURE}`);
console.log(`   Require TLS: ${config.SMTP_REQUIRE_TLS}`);
console.log(`   Verify Timeout: ${config.SMTP_VERIFY_TIMEOUT}ms`);
console.log(`   Environment: ${config.NODE_ENV}\n`);

// Validar configuración
if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.log('❌ Email Service está deshabilitado');
    console.log('   → Faltan SMTP_USER y/o SMTP_PASS en .env\n');
    process.exit(1);
}

function buildTransportConfig({ port = config.SMTP_PORT, secure = config.SMTP_SECURE, requireTLS = config.SMTP_REQUIRE_TLS } = {}) {
    return config.SMTP_HOST
        ? {
            host: config.SMTP_HOST,
            port,
            secure,
            auth: {
                user: config.SMTP_USER,
                pass: config.SMTP_PASS
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 15000,
            requireTLS: !secure && requireTLS
        }
        : {
            service: 'gmail',
            auth: {
                user: config.SMTP_USER,
                pass: config.SMTP_PASS
            }
        };
}

function describeTransport() {
    if (!config.SMTP_HOST) return 'gmail';
    const mode = config.SMTP_SECURE ? 'SSL' : (config.SMTP_REQUIRE_TLS ? 'STARTTLS' : 'sin SSL');
    return `${config.SMTP_HOST}:${config.SMTP_PORT} (${mode})`;
}

// Intentar verificar con timeout
console.log('🔍 Verificando conexión SMTP...');
const startTime = Date.now();

(async () => {
    const transporter = nodemailer.createTransport(buildTransportConfig());
    await Promise.race([
        transporter.verify(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Verification timeout')), config.SMTP_VERIFY_TIMEOUT)
        )
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`✅ Email Service funcionando correctamente (${elapsed}ms)`);
    console.log(`   Transporte: ${describeTransport()}\n`);
    console.log('📧 Puedes enviar emails desde la aplicación.\n');
    process.exit(0);
})()
    .catch(err => {
        const elapsed = Date.now() - startTime;
        console.log(`⚠️  Email Service no disponible (${elapsed}ms)`);
        console.log(`   Razón: ${err.message}\n`);
        
        if (config.NODE_ENV === 'development') {
            console.log('💡 Soluciones para desarrollo:');
            console.log('   1. Si está en LAN local sin internet: es esperado, el servidor continúa');
            console.log('   2. Configurar un SMTP alternativo (Gmail, Mailtrap, etc.)');
            console.log('   3. Reducir SMTP_VERIFY_TIMEOUT si es muy lenta la red\n');
        } else {
            console.log('❌ En producción: revisa la configuración SMTP y conectividad de red\n');
        }
        
        process.exit(0);
    });
