import { PipeTransform, Injectable } from '@nestjs/common';

@Injectable()
export class ParseCursorPipe implements PipeTransform {
  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return isNaN(n) ? undefined : n;
  }
}
