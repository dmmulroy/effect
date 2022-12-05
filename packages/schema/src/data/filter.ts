/**
 * @since 1.0.0
 */
import { pipe } from "@fp-ts/data/Function"
import * as O from "@fp-ts/data/Option"
import type { Arbitrary } from "@fp-ts/schema/Arbitrary"
import type { Decoder } from "@fp-ts/schema/Decoder"
import type { Guard } from "@fp-ts/schema/Guard"
import * as I from "@fp-ts/schema/internal/common"
import type { JsonEncoder } from "@fp-ts/schema/JsonEncoder"
import type { Pretty } from "@fp-ts/schema/Pretty"
import * as P from "@fp-ts/schema/Provider"
import type { Schema } from "@fp-ts/schema/Schema"

/**
 * @since 1.0.0
 */
export const filter = <B>(
  id: symbol,
  decode: Decoder<B, B>["decode"]
) => {
  const _predicate = (b: B): boolean => !I.isFailure(decode(b))

  const _guard = (self: Guard<B>): Guard<B> =>
    I.makeGuard(schema(self), (u): u is B => self.is(u) && _predicate(u))

  const _unknownDecoder = <I>(self: Decoder<I, B>): Decoder<I, B> =>
    I.makeDecoder(schema(self), (i) => pipe(self.decode(i), I.flatMap(decode)))

  const _jsonEncoder = (self: JsonEncoder<B>): JsonEncoder<B> =>
    I.makeEncoder(schema(self), self.encode)

  const _arbitrary = (self: Arbitrary<B>): Arbitrary<B> =>
    I.makeArbitrary(schema(self), (fc) => self.arbitrary(fc).filter(_predicate))

  const _pretty = (self: Pretty<B>): Pretty<B> => I.makePretty(schema(self), (b) => self.pretty(b))

  const Provider = P.make(id, {
    [I.GuardId]: _guard,
    [I.ArbitraryId]: _arbitrary,
    [I.UnknownDecoderId]: _unknownDecoder,
    [I.JsonDecoderId]: _unknownDecoder,
    [I.UnknownEncoderId]: _jsonEncoder,
    [I.JsonEncoderId]: _jsonEncoder,
    [I.PrettyId]: _pretty
  })

  const schema = <A extends B>(self: Schema<A>): Schema<A> =>
    I.declareSchema(id, O.none, Provider, self)

  return schema
}