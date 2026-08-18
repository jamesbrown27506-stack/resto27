/**
 * The id of the synthetic section that gathers dishes with no category, so
 * screens can recognise it and translate its label instead of displaying the
 * French fallback name verbatim.
 *
 * Lives here (not in lib/data/public.ts) because it is needed by client
 * components, and lib/data/public.ts is server-only.
 */
export const UNCATEGORIZED_SECTION_ID = "__uncategorized__";
