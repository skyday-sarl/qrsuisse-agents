// Public names for the types generated from the OpenAPI specification (src/generated/openapi.ts).
// Never edit the generated file: run `npm run generate` after updating spec/openapi.yaml.

import type { components, operations } from "./generated/openapi.js";

type Schemas = components["schemas"];

/** A QR code, as returned by the API. */
export type QrCode = Schemas["QrCodeApiDto"];
export type QrCodeType = Schemas["QrCodeType"];
export type QrCodeListPage = Schemas["QrCodeListPage"];
/** Effective style of a QR code or a template (read-only: a style is only applied through a template). */
export type QrStyle = Schemas["QrStyle"];
export type VCardData = Schemas["VCardData"];
export type PhoneEntry = Schemas["PhoneEntry"];
export type EmailEntry = Schemas["EmailEntry"];
export type AddressEntry = Schemas["AddressEntry"];

/** Body of `POST /qr-codes`, discriminated by `type` (`URL` or `VCARD`). */
export type QrCodeCreateInput = Schemas["QrCodeCreateInput"];
export type QrCodeCreateUrlInput = Schemas["QrCodeCreateUrlInput"];
export type QrCodeCreateVcardInput = Schemas["QrCodeCreateVcardInput"];
/** Body of `PATCH /qr-codes/{id}`: every field is optional, a missing field is left unchanged. */
export type QrCodeUpdateInput = Schemas["QrCodeUpdateInput"];

export type QrCodeStats = Schemas["StatsApiDto"];
export type Usage = Schemas["UsageApiDto"];
export type QrTemplate = Schemas["QrTemplateApiDto"];
export type QrTemplateList = Schemas["QrTemplateList"];

/** Body shared by every error of API v1. */
export type ApiErrorBody = Schemas["ApiErrorBase"];
/** The stable error codes documented by the API. */
export type ApiErrorCode = ApiErrorBody["error"];

/** Query parameters of `GET /qr-codes` (filters, sort and pagination). */
export type ListQrCodesParams = NonNullable<operations["listQrCodes"]["parameters"]["query"]>;
/** Filter and sort parameters of `GET /qr-codes`, without the pagination ones. */
export type QrCodeListFilters = Omit<ListQrCodesParams, "cursor">;

export type QrCodeImageFormat = NonNullable<NonNullable<operations["getQrCodeImage"]["parameters"]["query"]>["format"]>;
