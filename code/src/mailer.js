import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT) || 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        console.warn('[Mailer] SMTP 未配置，邮件发送功能不可用');
        return null;
    }

    transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });

    return transporter;
}

export async function sendRedeemEmail({ to, apiKey, packageName, limits }) {
    const t = getTransporter();
    if (!t) {
        console.warn('[Mailer] SMTP 未配置，跳过邮件发送');
        return false;
    }

    const fromName = process.env.SMTP_FROM_NAME || 'Kiro API';
    const from = `"${fromName}" <${process.env.SMTP_USER}>`;

    let limitsText = [];
    if (limits.dailyLimit > 0) limitsText.push(`日限 ${limits.dailyLimit} 次`);
    if (limits.monthlyLimit > 0) limitsText.push(`月限 ${limits.monthlyLimit} 次`);
    if (limits.totalCostLimit > 0) limitsText.push(`金额限制 $${limits.totalCostLimit}`);
    if (limits.expiresInDays > 0) limitsText.push(`有效期 ${limits.expiresInDays} 天`);

    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: linear-gradient(135deg, #6366f1, #a855f7); width: 48px; height: 48px; border-radius: 10px; line-height: 48px; font-size: 22px; font-weight: 700; color: white;">K</div>
            <h2 style="color: #ffffff; margin: 12px 0 4px;">兑换成功</h2>
            <p style="color: #888; font-size: 14px; margin: 0;">您的 API Key 已生成</p>
        </div>
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">套餐</p>
            <p style="font-size: 16px; font-weight: 600; color: #a78bfa; margin: 0;">${packageName}</p>
        </div>
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">API Key</p>
            <p style="font-family: 'SF Mono', Monaco, 'Courier New', monospace; font-size: 14px; color: #6366f1; word-break: break-all; margin: 0; padding: 12px; background: #0f0f23; border-radius: 6px;">${apiKey}</p>
        </div>
        ${limitsText.length > 0 ? `
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">配额信息</p>
            <p style="font-size: 14px; color: #e0e0e0; margin: 0;">${limitsText.join(' | ')}</p>
        </div>` : ''}
        <p style="font-size: 12px; color: #666; text-align: center; margin-top: 24px;">请妥善保管您的 API Key，切勿泄露给他人。</p>
    </div>`;

    try {
        await t.sendMail({
            from,
            to,
            subject: `[Kiro API] 兑换成功 - ${packageName}`,
            html
        });
        console.log(`[Mailer] 邮件已发送至 ${to}`);
        return true;
    } catch (error) {
        console.error('[Mailer] 发送失败:', error.message);
        return false;
    }
}

export async function sendTrialApprovalEmail({ to, apiKey, costLimit, expireHours }) {
    const t = getTransporter();
    if (!t) return false;

    const fromName = process.env.SMTP_FROM_NAME || 'Kiro API';
    const from = `"${fromName}" <${process.env.SMTP_USER}>`;

    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: linear-gradient(135deg, #6366f1, #a855f7); width: 48px; height: 48px; border-radius: 10px; line-height: 48px; font-size: 22px; font-weight: 700; color: white;">K</div>
            <h2 style="color: #ffffff; margin: 12px 0 4px;">试用申请已通过</h2>
            <p style="color: #888; font-size: 14px; margin: 0;">您的试用 API Key 已生成</p>
        </div>
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">API Key</p>
            <p style="font-family: 'SF Mono', Monaco, 'Courier New', monospace; font-size: 14px; color: #6366f1; word-break: break-all; margin: 0; padding: 12px; background: #0f0f23; border-radius: 6px;">${apiKey}</p>
        </div>
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">试用配额</p>
            <p style="font-size: 14px; color: #e0e0e0; margin: 0;">金额限制 $${costLimit} | 有效期 ${expireHours} 小时</p>
        </div>
        <p style="font-size: 12px; color: #666; text-align: center; margin-top: 24px;">请妥善保管您的 API Key，切勿泄露给他人。</p>
    </div>`;

    try {
        await t.sendMail({
            from,
            to,
            subject: `[Kiro API] 试用申请已通过`,
            html
        });
        console.log(`[Mailer] 试用审批邮件已发送至 ${to}`);
        return true;
    } catch (error) {
        console.error('[Mailer] 发送失败:', error.message);
        return false;
    }
}

export async function sendRechargeEmail({ to, packageName, limits }) {
    const t = getTransporter();
    if (!t) return false;

    const fromName = process.env.SMTP_FROM_NAME || 'Kiro API';
    const from = `"${fromName}" <${process.env.SMTP_USER}>`;

    let limitsText = [];
    if (limits.dailyLimit > 0) limitsText.push(`日限 ${limits.dailyLimit} 次`);
    if (limits.monthlyLimit > 0) limitsText.push(`月限 ${limits.monthlyLimit} 次`);
    if (limits.totalCostLimit > 0) limitsText.push(`金额限制 $${limits.totalCostLimit}`);
    if (limits.expiresInDays > 0) limitsText.push(`有效期 ${limits.expiresInDays} 天`);

    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: linear-gradient(135deg, #6366f1, #a855f7); width: 48px; height: 48px; border-radius: 10px; line-height: 48px; font-size: 22px; font-weight: 700; color: white;">K</div>
            <h2 style="color: #ffffff; margin: 12px 0 4px;">充值成功</h2>
            <p style="color: #888; font-size: 14px; margin: 0;">您的 API Key 已充值套餐</p>
        </div>
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">充值套餐</p>
            <p style="font-size: 16px; font-weight: 600; color: #a78bfa; margin: 0;">${packageName}</p>
        </div>
        ${limitsText.length > 0 ? `
        <div style="background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px;">当前配额</p>
            <p style="font-size: 14px; color: #e0e0e0; margin: 0;">${limitsText.join(' | ')}</p>
        </div>` : ''}
        <p style="font-size: 12px; color: #666; text-align: center; margin-top: 24px;">充值额度已叠加至您的 API Key。</p>
    </div>`;

    try {
        await t.sendMail({
            from,
            to,
            subject: `[Kiro API] 充值成功 - ${packageName}`,
            html
        });
        console.log(`[Mailer] 充值邮件已发送至 ${to}`);
        return true;
    } catch (error) {
        console.error('[Mailer] 发送失败:', error.message);
        return false;
    }
}
