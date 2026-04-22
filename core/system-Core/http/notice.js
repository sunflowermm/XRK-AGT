import { HttpResponse } from '#utils/http-utils.js';
import { InputValidator } from '#utils/input-validator.js';
import { noticeService } from '../lib/notice/notice-service.js';

function ensureSystemCoreAuth(req, res, Bot, context) {
  if (!Bot?.checkApiAuthorization?.(req)) {
    return HttpResponse.error(res, new Error('未授权'), 401, context || 'system-Core.notice');
  }
}

export default {
  name: 'notice',
  dsc: '通知服务 API（IYUU/Server酱/飞书）',
  priority: 90,

  routes: [
    {
      method: 'POST',
      path: '/api/notice/send',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const authResp = ensureSystemCoreAuth(req, res, Bot, 'notice.send');
        if (authResp) return authResp;

        const title = InputValidator.sanitizeText(req.body?.title, 200) || 'XRK-AGT 通知';
        const content = InputValidator.sanitizeText(req.body?.content, 10_000) || '';
        const channels = Array.isArray(req.body?.channels) ? req.body.channels : undefined;

        const results = await noticeService.send({ title, content, channels });
        HttpResponse.success(res, { results, timestamp: Date.now() });
      }, 'notice.send')
    },
    {
      method: 'POST',
      path: '/api/notice/test',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const authResp = ensureSystemCoreAuth(req, res, Bot, 'notice.test');
        if (authResp) return authResp;
        const results = await noticeService.send({
          title: 'XRK-AGT 测试通知',
          content: `time=${new Date().toISOString()}`
        });
        HttpResponse.success(res, { results, timestamp: Date.now() });
      }, 'notice.test')
    }
  ]
};

