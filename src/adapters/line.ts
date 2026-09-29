import type { Sender } from '../services/delivery.ts';

/**
 * LINE Messaging API — target: 'broadcast' หรือ userId/groupId (PRD ข้อ 17 #1 ยังรอตัดสินใจ)
 * ใช้ X-Line-Retry-Key = delivery id เพื่อกันส่งซ้ำเมื่อ retry
 */
export function lineSender(accessToken: string, target: string, fetchImpl: typeof fetch = fetch): Sender {
  return {
    async send(text, retryKey) {
      const broadcast = target === 'broadcast';
      const res = await fetchImpl(`https://api.line.me/v2/bot/message/${broadcast ? 'broadcast' : 'push'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'X-Line-Retry-Key': retryKey },
        body: JSON.stringify(broadcast ? { messages: [{ type: 'text', text }] } : { to: target, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(15_000),
      });
      // 409 = retry key นี้ถูกรับไปแล้ว (ส่งสำเร็จมาก่อน) ถือว่าสำเร็จ
      if (res.ok || res.status === 409) return { ok: true, status: res.status };
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `LINE ${res.status} ${detail.slice(0, 200)}` };
    },
  };
}

/** ใช้ตอน dry-run/ทดสอบ: พิมพ์แทนการส่งจริง */
export function consoleSender(log: (s: string) => void = console.log): Sender {
  return {
    async send(text) {
      log(`--- [DRY SEND] ---\n${text}\n------------------`);
      return { ok: true, status: 200 };
    },
  };
}
