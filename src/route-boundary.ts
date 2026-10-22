import type { z } from "zod";

import type {
  BodyValidationOptions,
  MaybePromise,
  RouteBoundaryBuilder,
  RouteBoundaryContext,
  RouteBoundaryErrorContext,
  RouteBoundaryErrorMapper,
  RouteBoundaryFetchHandler,
  RouteBoundaryGuard,
  RouteBoundaryGuardOutcome,
  RouteBoundaryHandler,
  RouteBoundaryOptions,
  RouteBoundaryRequestGuard,
  RouteBoundaryRequestOptions,
  RouteBoundaryValidationError,
  RouteBoundaryValidationHandler,
} from "./types.js";

import { createBoundaryErrorHandler } from "./error-handler.js";
import { errorJson } from "./responses.js";
import {
  formatZodError,
  validateJsonBody,
  validateQueryParams,
} from "./validation.js";

type BoundaryConfig = {
  bodySchema?: z.ZodTypeAny;
  bodyOptions?: BodyValidationOptions;
  querySchema?: z.ZodTypeAny;
  paramsSchema?: z.ZodTypeAny;
  requestGuards: ErasedRequestGuard[];
  guards: ErasedGuard[];
  errorMappers: RouteBoundaryErrorMapper[];
  validationHandlers: RouteBoundaryValidationHandler[];
};

type BoundaryContextRecord = Record<string, unknown>;
type ErasedGuardOutcome = RouteBoundaryGuardOutcome<BoundaryContextRecord>;
type ErasedRequestGuard = (input: {
  request: Request;
  context: BoundaryContextRecord;
}) => MaybePromise<ErasedGuardOutcome>;
type ErasedGuard = (input: {
  request: Request;
  context: BoundaryContextRecord;
  body?: unknown;
  query?: unknown;
  params?: unknown;
}) => MaybePromise<ErasedGuardOutcome>;

class ImmutableRouteBoundaryBuilder<
  TContext extends BoundaryContextRecord = Record<string, never>,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
> implements RouteBoundaryBuilder<TContext, TBody, TQuery, TParams> {
  constructor(
    private readonly options: RouteBoundaryOptions<TContext>,
    private readonly config: BoundaryConfig,
  ) {}

  body<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    options?: BodyValidationOptions,
  ): RouteBoundaryBuilder<TContext, z.infer<TSchema>, TQuery, TParams> {
    return this.withConfig({ bodySchema: schema, bodyOptions: options });
  }

  query<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
  ): RouteBoundaryBuilder<TContext, TBody, z.infer<TSchema>, TParams> {
    return this.withConfig({ querySchema: schema });
  }

  params<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
  ): RouteBoundaryBuilder<TContext, TBody, TQuery, z.infer<TSchema>> {
    return this.withConfig({ paramsSchema: schema });
  }

  requestGuard<TAddedContext extends BoundaryContextRecord>(
    guard: RouteBoundaryRequestGuard<TContext, TAddedContext>,
  ): RouteBoundaryBuilder<TContext & TAddedContext, TBody, TQuery, TParams> {
    return this.withConfig({
      requestGuards: [
        ...this.config.requestGuards,
        guard as unknown as ErasedRequestGuard,
      ],
    });
  }

  guard<TAddedContext extends BoundaryContextRecord>(
    guard: RouteBoundaryGuard<TContext, TAddedContext, TBody, TQuery, TParams>,
  ): RouteBoundaryBuilder<TContext & TAddedContext, TBody, TQuery, TParams> {
    return this.withConfig({
      guards: [...this.config.guards, guard as unknown as ErasedGuard],
    });
  }

  onError(
    mapper: RouteBoundaryErrorMapper<TContext, TBody, TQuery, TParams>,
  ): RouteBoundaryBuilder<TContext, TBody, TQuery, TParams> {
    return this.withConfig({
      errorMappers: [
        ...this.config.errorMappers,
        mapper as RouteBoundaryErrorMapper,
      ],
    });
  }

  onValidationError(
    handler: RouteBoundaryValidationHandler<TContext, TBody, TQuery, TParams>,
  ): RouteBoundaryBuilder<TContext, TBody, TQuery, TParams> {
    return this.withConfig({
      validationHandlers: [
        ...this.config.validationHandlers,
        handler as RouteBoundaryValidationHandler,
      ],
    });
  }

  handle(
    handler: RouteBoundaryHandler<TContext, TBody, TQuery, TParams>,
  ): RouteBoundaryFetchHandler<TParams> {
    const fetchHandler = async (
      request: Request,
      requestOptions?: RouteBoundaryRequestOptions<TParams>,
    ) => {
      const errorHandler =
        this.options.errorHandler ?? createBoundaryErrorHandler();
      const state: RouteBoundaryErrorContext<TContext, TBody, TQuery, TParams> =
        {
          request,
        };

      const validationFailure = async (
        failure: RouteBoundaryValidationError,
      ): Promise<Response> => {
        for (const validationHandler of this.config.validationHandlers) {
          const response = await validationHandler(
            failure,
            state as RouteBoundaryErrorContext,
          );
          if (response) return response;
        }
        return failure.response;
      };

      try {
        const configuredContext = this.options.context;
        let context =
          typeof configuredContext === "function"
            ? await (
                configuredContext as (
                  request: Request,
                ) => MaybePromise<TContext>
              )(request)
            : (configuredContext ?? ({} as TContext));
        state.context = context;

        const handlerContext: {
          request: Request;
          context: BoundaryContextRecord;
          body?: unknown;
          query?: unknown;
          params?: unknown;
        } = {
          request,
          context,
        };

        for (const guard of this.config.requestGuards) {
          const result = await guard({
            request,
            context: context as BoundaryContextRecord,
          });
          if (!result.ok) return result.response;
          context = { ...(context as object), ...result.context } as TContext;
          state.context = context;
          handlerContext.context = context;
        }

        if (this.config.paramsSchema) {
          const result = this.config.paramsSchema.safeParse(
            requestOptions?.params,
          );
          if (!result.success) {
            return validationFailure({
              source: "params",
              error: result.error,
              response: errorJson(formatZodError(result.error), 400),
              receivedData: requestOptions?.params,
            });
          }
          state.params = result.data as TParams;
          handlerContext.params = result.data;
        }

        if (this.config.querySchema) {
          const result = validateQueryParams(
            this.config.querySchema,
            request.url,
          );
          if (!result.ok) {
            return validationFailure({
              source: "query",
              error: result.error,
              response: result.response,
              receivedData: result.receivedData,
            });
          }
          state.query = result.data as TQuery;
          handlerContext.query = result.data;
        }

        if (this.config.bodySchema) {
          const result = await validateJsonBody(
            request,
            this.config.bodySchema,
            this.config.bodyOptions,
          );
          if (!result.ok) {
            return validationFailure({
              source: result.reason,
              response: result.response,
              receivedData: result.receivedData,
              ...("error" in result && result.error
                ? { error: result.error }
                : {}),
            } as RouteBoundaryValidationError);
          }
          state.body = result.data as TBody;
          handlerContext.body = result.data;
        }

        for (const guard of this.config.guards) {
          const result = await guard(handlerContext);
          if (!result.ok) return result.response;
          context = { ...(context as object), ...result.context } as TContext;
          state.context = context;
          handlerContext.context = context;
        }

        return await handler(
          handlerContext as RouteBoundaryContext<
            TContext,
            TBody,
            TQuery,
            TParams
          >,
        );
      } catch (error) {
        let mappedError = error;
        for (const mapper of this.config.errorMappers) {
          try {
            mappedError = await mapper(mappedError, state);
          } catch (mapperError) {
            mappedError = mapperError;
            break;
          }
        }
        return errorHandler(mappedError, state);
      }
    };
    return fetchHandler as RouteBoundaryFetchHandler<TParams>;
  }

  private withConfig<
    TNextContext extends BoundaryContextRecord = TContext,
    TNextBody = TBody,
    TNextQuery = TQuery,
    TNextParams = TParams,
  >(
    patch: Partial<BoundaryConfig>,
  ): RouteBoundaryBuilder<TNextContext, TNextBody, TNextQuery, TNextParams> {
    return new ImmutableRouteBoundaryBuilder<
      TNextContext,
      TNextBody,
      TNextQuery,
      TNextParams
    >(this.options as unknown as RouteBoundaryOptions<TNextContext>, {
      ...this.config,
      ...patch,
    });
  }
}

export function createRouteBoundary<
  TContext extends BoundaryContextRecord = Record<string, never>,
>(
  options: RouteBoundaryOptions<TContext> = {},
): RouteBoundaryBuilder<TContext> {
  return new ImmutableRouteBoundaryBuilder(options, {
    requestGuards: [],
    guards: [],
    errorMappers: [],
    validationHandlers: [],
  });
}
