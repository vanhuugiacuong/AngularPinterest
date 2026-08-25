import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

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
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Ảnh vượt quá dung lượng tối đa cho phép.',
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
