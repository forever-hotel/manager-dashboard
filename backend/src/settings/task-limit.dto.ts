import { IsInt, Max, Min } from 'class-validator';
export class TaskLimitQueryDto {}
export class UpdateTaskLimitDto {
  @IsInt() @Min(1) @Max(10) limit!: number;
  @IsInt() @Min(0) @Max(2147483646) version!: number;
}
