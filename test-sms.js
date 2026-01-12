#!/usr/bin/env node

/**
 * NCP SENS SMS 인증 테스트 스크립트
 *
 * 사용법:
 *   node test-sms.js <전화번호>
 *   예: node test-sms.js 01012345678
 *
 * 환경변수가 Supabase에 설정되어 있어야 합니다:
 *   - NCP_SENS_ACCESS_KEY
 *   - NCP_SENS_SECRET_KEY
 *   - NCP_SENS_SERVICE_ID
 *   - NCP_SENS_SMS_FROM
 */

// Load .env file
require('dotenv').config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ubeginyxaotcamuqpmud.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const testPhone = process.argv[2];

if (!testPhone) {
    console.error('❌ 전화번호를 입력해주세요.');
    console.log('사용법: node test-sms.js 01012345678');
    process.exit(1);
}

const cleanPhone = testPhone.replace(/[^0-9]/g, '');
if (cleanPhone.length !== 11) {
    console.error('❌ 전화번호는 11자리 숫자여야 합니다.');
    process.exit(1);
}

console.log('📱 NCP SENS SMS 인증 테스트');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`전화번호: ${cleanPhone}`);
console.log(`Supabase URL: ${SUPABASE_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function testSmsOtp() {
    try {
        console.log('1️⃣  OTP 요청 전송 중...');

        const response = await fetch(`${SUPABASE_URL}/functions/v1/request-signup-otp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                phone: cleanPhone,
            }),
        });

        const data = await response.json();

        console.log(`\nHTTP Status: ${response.status}`);
        console.log('Response:', JSON.stringify(data, null, 2));

        if (data.ok) {
            console.log('\n✅ SMS 전송 성공!');
            if (data.test_mode) {
                console.log('⚠️  테스트 모드로 실행됨 (실제 SMS 발송 안됨)');
                console.log('💡 프로덕션 환경에서는 TEST_SMS_MODE=false로 설정하세요.');
            } else {
                console.log('📲 SMS가 발송되었습니다. 휴대폰을 확인하세요.');
            }
            if (data.already_verified) {
                console.log('ℹ️  이미 인증된 전화번호입니다.');
            }
        } else {
            console.log('\n❌ SMS 전송 실패');
            console.log(`에러 코드: ${data.code}`);
            console.log(`메시지: ${data.message}`);

            // 에러 상황별 도움말
            if (data.code === 'cooldown') {
                console.log('\n💡 60초 후에 다시 시도하세요.');
            } else if (data.code === 'locked') {
                console.log('\n💡 너무 많은 시도로 인해 일시적으로 잠겼습니다.');
            } else if (data.code === 'sms_send_failed') {
                console.log('\n💡 NCP SENS 설정을 확인하세요:');
                console.log('   - Supabase Dashboard > Project Settings > Edge Functions');
                console.log('   - 환경변수가 올바르게 설정되었는지 확인');
            }
        }

    } catch (error) {
        console.error('\n❌ 네트워크 오류:', error.message);
        console.log('\n💡 확인사항:');
        console.log('   1. Supabase URL이 올바른지 확인');
        console.log('   2. Edge Function이 배포되었는지 확인');
        console.log('   3. 인터넷 연결 상태 확인');
    }
}

// 테스트 실행
testSmsOtp();
