// Applicant-facing strings (docs/policy.md §6: plain, short, in the applicant's language). EN/ES in the demo.
export type Lang = "en" | "es";

export function normalizeLang(lang: string | undefined | null): Lang {
  return (lang ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

export const MESSAGES: Record<
  Lang,
  {
    proofOfResidence: string;
    clearPhoto: string;
    followUpIntro: string;
    status: Record<"new" | "evaluating" | "needs_info" | "needs_review" | "approved" | "parked" | "paying" | "paid" | "rejected", string>;
  }
> = {
  en: {
    proofOfResidence:
      "The zip code you entered is outside the declared area. Please send one document that shows your primary residence in the area, such as a utility bill, a lease, or an ID with the address.",
    clearPhoto:
      "We could not see the damage in the photos you sent. Please send at least one clear, well-lit photo of the damage (for example the water line on a wall, damaged belongings, or an evacuation notice).",
    followUpIntro: "To finish reviewing your application we need a little more information:",
    status: {
      new: "Received",
      evaluating: "Under review",
      needs_info: "We need more information",
      needs_review: "Under review by a volunteer",
      approved: "Approved — payment on its way",
      parked: "Approved — waiting for funds",
      paying: "Payment sent",
      paid: "Paid",
      rejected: "Not approved",
    },
  },
  es: {
    proofOfResidence:
      "El código postal que ingresó está fuera del área declarada. Envíe un documento que muestre su residencia principal en el área, como una factura de servicios, un contrato de alquiler o una identificación con la dirección.",
    clearPhoto:
      "No pudimos ver los daños en las fotos que envió. Por favor envíe al menos una foto clara y bien iluminada de los daños (por ejemplo, la marca del agua en una pared, pertenencias dañadas o un aviso de evacuación).",
    followUpIntro: "Para terminar de revisar su solicitud necesitamos un poco más de información:",
    status: {
      new: "Recibida",
      evaluating: "En revisión",
      needs_info: "Necesitamos más información",
      needs_review: "En revisión por un voluntario",
      approved: "Aprobada — el pago está en camino",
      parked: "Aprobada — esperando fondos",
      paying: "Pago enviado",
      paid: "Pagada",
      rejected: "No aprobada",
    },
  },
};
