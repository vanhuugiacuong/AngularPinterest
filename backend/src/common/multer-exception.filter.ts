import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { PIN_IMAGE_TOO_LARGE_MESSAGE } from './upload-limits';

/** Without this filter, exceeding a FileInterceptor's `fileSize` limit (or
 * any other Multer-level upload error) throws a raw MulterError that Nest's
 * default filter doesn't recognize as an HttpException — it falls through
 * to a bare 500 "Internal server error" with no useful message, on every
 * file-upload endpoint in the app (avatar, pin upload, watermark logo...).
 * This maps the Multer error codes that can actually occur here to a real
 * status code and a Vietnamese message the frontend can show as-is. */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception.code === 'LIMIT_FILE_SIZE') {
      const request = host.switchToHttp().getRequest<Request>();
      const requestPath = request.originalUrl.split('?')[0].replace(/\/$/, '');
      const isPinPublishingRequest = /\/api\/pins(?:\/check-image)?$/.test(requestPath);
      const statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      response.status(statusCode).json({
        statusCode,
        message: isPinPublishingRequest
          ? PIN_IMAGE_TOO_LARGE_MESSAGE
          : 'Ảnh vượt quá dung lượng tối đa cho phép.',
      });
      return;
    }

    console.error('[MulterExceptionFilter] Lỗi upload file:', exception);
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Không thể xử lý file đã tải lên.',
    });
  }
}
