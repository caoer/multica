import { loader } from "fumadocs-core/source";
import { useCases } from "@/.source";

export const useCasesSource = loader({
  baseUrl: "/use-cases",
  source: useCases.toFumadocsSource(),
});
