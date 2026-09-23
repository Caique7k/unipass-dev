import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Teto de itens por página.
 *
 * Precisa ser >= 1000 porque os formulários que montam combos (grupos, rotas e
 * grupos de boletos no cadastro de aluno) pedem a lista inteira com
 * `limit=1000`. Sem teto, um cliente conseguia pedir `limit=999999` e derrubar
 * a resposta.
 */
export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Base de paginação compartilhada pelas listagens.
 *
 * Herde dela em vez de reler `@Query('page')` na mão: valores inválidos
 * (`page=0`, `page=-1`, `page=abc`) passam a devolver 400 em vez de 500, e o
 * `limit` fica com teto em todos os endpoints.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
