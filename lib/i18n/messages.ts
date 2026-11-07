// Applicant-facing strings (policy.md §6: plain, short, in the applicant's language). EN/ES in the demo.
import type { CaseStatus } from "@/lib/agent/schema";

export type Lang = "en" | "es";

export function normalizeLang(lang: string | undefined | null): Lang {
  return (lang ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

export interface Strings {
  proofOfResidence: string;
  clearPhoto: string;
  followUpIntro: string;
  status: Record<CaseStatus, string>;
  statusHint: Record<CaseStatus, string>;
  apply: {
    title: string;
    intro: string;
    steps: [string, string, string];
    name: string;
    email: string;
    emailHint: string;
    phone: string;
    address: string;
    zip: string;
    householdSize: string;
    requestedAmount: string;
    narrative: string;
    narrativeHint: string;
    photos: string;
    photosHint: string;
    docs: string;
    docsHint: string;
    back: string;
    next: string;
    review: string;
    submit: string;
    submitting: string;
    optional: string;
    consent: string;
    stepOf: string;
    language: string;
    addPhotos: string;
    addDocument: string;
    remove: string;
    reviewTitle: string;
    errors: { required: string; email: string; zip: string; photos: string; tooLarge: string; failed: string };
  };
  status_page: {
    title: string;
    caseLabel: string;
    received: string;
    timeline: string;
    message: string;
    amount: string;
    batch: string;
    replyTitle: string;
    replyText: string;
    replyPhotos: string;
    replySubmit: string;
    replySent: string;
    notFound: string;
    keepLink: string;
  };
}

const en: Strings = {
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
    approved: "Approved, payment on its way",
    parked: "Approved, waiting for funds",
    paying: "Payment sent",
    paid: "Paid",
    rejected: "Not approved",
  },
  statusHint: {
    new: "Your application is in the queue. Reviews usually take minutes.",
    evaluating: "The case officer is reading your application and photos right now.",
    needs_info: "Answer below and we will look again right away.",
    needs_review: "A volunteer is looking at your case. You do not need to do anything.",
    approved: "The grant is approved. The payment is being prepared.",
    parked: "The grant is approved. It will be paid as soon as the fund receives more donations.",
    paying: "PayPal is delivering the money to the email address you gave us. Check your PayPal account.",
    paid: "The money is in your PayPal account.",
    rejected: "A volunteer reviewed the case and could not approve it under the fund's policy.",
  },
  apply: {
    title: "Apply for assistance",
    intro: "Three short steps. You will get a link to follow your case; most answers arrive within minutes.",
    steps: ["Your contact", "What happened", "Photos and review"],
    name: "Your name",
    email: "PayPal email",
    emailHint: "The grant is paid to this email through PayPal. It must be the email of your PayPal account.",
    phone: "Phone",
    address: "Street address of the damaged home",
    zip: "Zip code",
    householdSize: "People in the household",
    requestedAmount: "Amount you are asking for (USD)",
    narrative: "What happened?",
    narrativeHint: "A few sentences in your own words: what was damaged, whether you can stay in the home, what you need most.",
    photos: "Photos of the damage",
    photosHint: "Up to 3 photos. Water lines, damaged belongings, evacuation notices. No faces are needed.",
    docs: "Document",
    docsHint: "Optional: one document such as a receipt, a lease, or a notice.",
    back: "Back",
    next: "Next",
    review: "Review",
    submit: "Submit application",
    submitting: "Submitting…",
    optional: "optional",
    stepOf: "Step {n} of {total}",
    language: "Language",
    addPhotos: "Add photos",
    addDocument: "Add a document",
    remove: "Remove",
    reviewTitle: "Check your answers",
    consent: "By submitting you confirm the information is true. Your photos and contact details are private; only an anonymized summary appears on the public ledger.",
    errors: {
      required: "This field is required.",
      email: "Enter a valid email address.",
      zip: "Enter a 5-digit zip code.",
      photos: "Please add at least one photo.",
      tooLarge: "Each file must be under 10 MB.",
      failed: "Something went wrong. Please try again.",
    },
  },
  status_page: {
    title: "Your application",
    caseLabel: "Case",
    received: "Received",
    timeline: "Progress",
    message: "Message from the fund",
    amount: "Grant amount",
    batch: "PayPal payout batch",
    replyTitle: "Send the information requested",
    replyText: "Your answer",
    replyPhotos: "New photos or documents",
    replySubmit: "Send",
    replySent: "Thank you. Your case is back in review.",
    notFound: "We could not find an application for this link.",
    keepLink: "Keep this link. It is the only way to see your case; there is no login.",
  },
};

const es: Strings = {
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
    approved: "Aprobada, el pago está en camino",
    parked: "Aprobada, esperando fondos",
    paying: "Pago enviado",
    paid: "Pagada",
    rejected: "No aprobada",
  },
  statusHint: {
    new: "Su solicitud está en la fila. La revisión suele tardar minutos.",
    evaluating: "El oficial de casos está leyendo su solicitud y sus fotos en este momento.",
    needs_info: "Responda abajo y la revisaremos de nuevo enseguida.",
    needs_review: "Un voluntario está revisando su caso. No necesita hacer nada.",
    approved: "La ayuda está aprobada. El pago se está preparando.",
    parked: "La ayuda está aprobada. Se pagará en cuanto el fondo reciba más donaciones.",
    paying: "PayPal está entregando el dinero al correo que nos dio. Revise su cuenta de PayPal.",
    paid: "El dinero está en su cuenta de PayPal.",
    rejected: "Un voluntario revisó el caso y no pudo aprobarlo según la política del fondo.",
  },
  apply: {
    title: "Solicitar ayuda",
    intro: "Tres pasos cortos. Recibirá un enlace para seguir su caso; la mayoría de las respuestas llegan en minutos.",
    steps: ["Su contacto", "Qué pasó", "Fotos y revisión"],
    name: "Su nombre",
    email: "Correo de PayPal",
    emailHint: "La ayuda se paga a este correo a través de PayPal. Debe ser el correo de su cuenta de PayPal.",
    phone: "Teléfono",
    address: "Dirección de la vivienda dañada",
    zip: "Código postal",
    householdSize: "Personas en el hogar",
    requestedAmount: "Monto que solicita (USD)",
    narrative: "¿Qué pasó?",
    narrativeHint: "Unas frases con sus palabras: qué se dañó, si puede quedarse en la casa, qué necesita más.",
    photos: "Fotos de los daños",
    photosHint: "Hasta 3 fotos. Marcas de agua, pertenencias dañadas, avisos de evacuación. No hacen falta caras.",
    docs: "Documento",
    docsHint: "Opcional: un documento como un recibo, un contrato de alquiler o un aviso.",
    back: "Atrás",
    next: "Siguiente",
    review: "Revisar",
    submit: "Enviar solicitud",
    submitting: "Enviando…",
    optional: "opcional",
    stepOf: "Paso {n} de {total}",
    language: "Idioma",
    addPhotos: "Agregar fotos",
    addDocument: "Agregar un documento",
    remove: "Quitar",
    reviewTitle: "Revise sus respuestas",
    consent: "Al enviar confirma que la información es verdadera. Sus fotos y datos de contacto son privados; en el registro público solo aparece un resumen anónimo.",
    errors: {
      required: "Este campo es obligatorio.",
      email: "Ingrese un correo válido.",
      zip: "Ingrese un código postal de 5 dígitos.",
      photos: "Agregue al menos una foto.",
      tooLarge: "Cada archivo debe pesar menos de 10 MB.",
      failed: "Algo salió mal. Inténtelo de nuevo.",
    },
  },
  status_page: {
    title: "Su solicitud",
    caseLabel: "Caso",
    received: "Recibida",
    timeline: "Progreso",
    message: "Mensaje del fondo",
    amount: "Monto de la ayuda",
    batch: "Lote de pago de PayPal",
    replyTitle: "Enviar la información solicitada",
    replyText: "Su respuesta",
    replyPhotos: "Nuevas fotos o documentos",
    replySubmit: "Enviar",
    replySent: "Gracias. Su caso vuelve a revisión.",
    notFound: "No encontramos una solicitud para este enlace.",
    keepLink: "Guarde este enlace. Es la única forma de ver su caso; no hay inicio de sesión.",
  },
};

export const MESSAGES: Record<Lang, Strings> = { en, es };

/** Statuses in the order shown on the applicant's timeline. */
export const TIMELINE: CaseStatus[] = ["new", "evaluating", "approved", "paying", "paid"];
