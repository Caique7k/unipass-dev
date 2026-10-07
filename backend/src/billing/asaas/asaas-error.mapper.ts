import { AsaasApiError } from './asaas-api.error';
import { ASAAS_ENVIRONMENT_LABEL, AsaasEnvironment } from './asaas.config';

const MAX_DESCRIPTIONS = 3;
const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Mensagem para o usuário a partir de uma falha do Asaas. Nunca inclui
 * stack, chave, headers ou a resposta crua — o detalhe técnico fica só no log
 * do AsaasClient (operação, status e códigos).
 */
export function describeAsaasError(
  error: unknown,
  environment?: AsaasEnvironment,
): string {
  if (!(error instanceof AsaasApiError)) {
    return 'Não foi possível concluir a operação com o Asaas. Tente novamente em alguns minutos.';
  }

  switch (error.kind) {
    case 'unauthorized':
      return (
        'O Asaas recusou a chave de API. Confira se ela foi copiada inteira, ' +
        'se continua ativa no painel do Asaas' +
        (environment
          ? ` e se é do ambiente ${ASAAS_ENVIRONMENT_LABEL[environment]}.`
          : '.')
      );
    case 'forbidden':
      return 'A conta Asaas não permite esta operação com essa chave. Verifique as permissões da chave no painel do Asaas.';
    case 'not_found':
      return 'O registro não foi encontrado no Asaas. Verifique o cadastro e tente novamente.';
    case 'validation': {
      // As descrições do Asaas são textos para gente ("O campo value deve
      // ser informado"); mostramos as primeiras, cortadas.
      const descriptions = error.details
        .map((detail) => detail.description)
        .filter((value): value is string => !!value)
        .slice(0, MAX_DESCRIPTIONS)
        .map((value) => value.slice(0, MAX_DESCRIPTION_LENGTH));

      return descriptions.length > 0
        ? `O Asaas recusou os dados: ${descriptions.join(' ')}`
        : 'O Asaas recusou os dados enviados. Revise o cadastro e tente novamente.';
    }
    case 'rate_limited':
      return error.retryAfterSeconds
        ? `O Asaas limitou temporariamente as requisições desta conta. Tente novamente em ${error.retryAfterSeconds} segundos.`
        : 'O Asaas limitou temporariamente as requisições desta conta. Tente novamente em alguns minutos.';
    case 'unavailable':
      return 'O Asaas está indisponível no momento. Tente novamente em alguns minutos.';
    case 'timeout':
      return 'O Asaas demorou demais para responder. Tente novamente em alguns minutos.';
    case 'network':
      return 'Não foi possível se comunicar com o Asaas. Verifique a conexão do servidor e tente novamente.';
    default:
      return 'O Asaas respondeu de forma inesperada. Tente novamente em alguns minutos.';
  }
}
