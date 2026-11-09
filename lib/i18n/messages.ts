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
    /** The heading inside each step's card (the progress row above it shows `steps`). */
    cardTitles: [string, string, string];
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
    requestedAmountHint: string;
    householdHint: string;
    metaTitle: string;
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
    /** Shown instead of `consent`, with `demoNotice` on the first step, while the demo operator console is open to look at. */
    consentDemo: string;
    demoNotice: string;
    stepOf: string;
    language: string;
    addPhotos: string;
    addDocument: string;
    remove: string;
    reviewTitle: string;
    /** `fileType` names the file: "We can’t read {name}. ..." */
    errors: { required: string; household: string; email: string; zip: string; photos: string; tooLarge: string; fileType: string; failed: string };
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
    metaTitle: string;
    /** "{amount} is now in your PayPal account." */
    paidTitle: string;
    /** "It arrived {duration} after you applied. ..." */
    paidHint: string;
    /** Each timeline step once it is done. */
    steps: Record<(typeof TIMELINE)[number], string>;
    /** The current step's label, by case status. */
    stepNow: Partial<Record<CaseStatus, string>>;
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
    new: "Your application is in line, and most reviews take only a few minutes.",
    evaluating: "Our AI case officer is reading your application and photos right now.",
    needs_info: "Please answer below, and we will look at your case again right away.",
    needs_review: "A volunteer is taking a closer look at your case. You don’t need to do anything for now.",
    approved: "Your grant is approved, and the payment is being prepared.",
    parked: "Your grant is approved and will be paid as soon as the fund receives more donations.",
    paying: "PayPal is sending the money to the email you gave us, so keep an eye on your PayPal account.",
    paid: "The money is in your PayPal account. We hope it helps you get back on your feet.",
    rejected: "A volunteer reviewed your case and could not approve it under the fund’s rules.",
  },
  apply: {
    title: "Get help after the flood",
    intro: "It takes about five minutes. Tell us what happened and add a photo of the damage, and you will get a private link to follow your case. Most people hear back within minutes.",
    steps: ["Your contact", "What happened", "Photos and review"],
    cardTitles: ["You and your home", "Tell us what happened", "Add photos and send"],
    name: "Your name",
    email: "PayPal email",
    emailHint: "We send the grant to this email through PayPal, so it needs to be the email on your PayPal account.",
    phone: "Phone",
    address: "Street address of the damaged home",
    zip: "Zip code",
    householdSize: "People in the household",
    requestedAmount: "Amount you are asking for (USD)",
    narrative: "In your own words",
    narrativeHint: "What was damaged? Can you still stay in your home? What do you need most?",
    requestedAmountHint: "The fund sets each grant by the level of damage and the size of your household, so this only helps us understand your needs.",
    householdHint: "Households of more than {n} people receive a larger grant.",
    metaTitle: "Get help",
    photos: "Photos of the damage",
    photosHint: "Up to 3 photos of the damage, such as a water line on a wall, ruined belongings or an evacuation notice. No faces needed.",
    docs: "Document",
    docsHint: "If you have one, add a receipt, a lease or a notice.",
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
    consent: "By submitting, you confirm that everything here is true. Your photos and contact details stay private, and only an anonymous one-line summary appears on the public ledger.",
    consentDemo:
      "This is a demo. What you wrote and your photos can be seen in the fund’s open staff console. Your name, email, phone and address stay hidden there, and only an anonymous one-line summary appears on the public ledger.",
    demoNotice:
      "Demo site: please use a made-up name and story, and no photos of real people. What you write and the photos you add can be seen in the fund’s open staff console. Your name, email, phone and address stay hidden.",
    errors: {
      required: "This field is required.",
      household: "Enter how many people live in your home.",
      email: "Enter a valid email address.",
      zip: "Enter a 5-digit zip code.",
      photos: "Please add at least one photo.",
      tooLarge: "Each file must be under 10 MB.",
      fileType: "We can’t read {name}. Please send it as a JPEG or PNG photo. iPhone HEIC photos are not supported yet.",
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
    batch: "PayPal reference",
    replyTitle: "Answer the questions above",
    replyText: "Your answers",
    replyPhotos: "New photos or documents",
    replySubmit: "Send my answers",
    replySent: "Thank you, your case is back in review.",
    notFound: "We could not find an application for this link.",
    keepLink: "Save this link. It is the only way back to your case, since there is no account or password.",
    metaTitle: "Your application",
    paidTitle: "{amount} is now in your PayPal account.",
    paidHint: "It arrived {duration} after you applied. We hope it helps you get back on your feet.",
    steps: {
      new: "Application received",
      evaluating: "Reviewed",
      approved: "Approved",
      paying: "Sent through PayPal",
      paid: "In your PayPal account",
    },
    stepNow: {
      new: "In line for review",
      evaluating: "Being reviewed now",
      needs_info: "Waiting for your answer",
      needs_review: "With a volunteer",
      approved: "Preparing your payment",
      parked: "Waiting for donations",
      paying: "PayPal is sending it",
    },
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
    new: "Su solicitud está en la fila, y la mayoría de las revisiones toma solo unos minutos.",
    evaluating: "Nuestro gestor de casos con IA está leyendo su solicitud y sus fotos en este momento.",
    needs_info: "Por favor responda abajo, y revisaremos su caso de nuevo enseguida.",
    needs_review: "Un voluntario está revisando su caso con más detalle. Por ahora no necesita hacer nada.",
    approved: "Su ayuda está aprobada, y el pago se está preparando.",
    parked: "Su ayuda está aprobada y se pagará en cuanto el fondo reciba más donaciones.",
    paying: "PayPal está enviando el dinero al correo que nos dio, así que revise su cuenta de PayPal.",
    paid: "El dinero está en su cuenta de PayPal. Esperamos que le ayude a salir adelante.",
    rejected: "Un voluntario revisó su caso y no pudo aprobarlo según las reglas del fondo.",
  },
  apply: {
    title: "Pida ayuda después de la inundación",
    intro: "Toma unos cinco minutos. Cuéntenos qué pasó y agregue una foto de los daños, y recibirá un enlace privado para seguir su caso. La mayoría recibe respuesta en minutos.",
    steps: ["Su contacto", "Qué pasó", "Fotos y revisión"],
    cardTitles: ["Usted y su hogar", "Cuéntenos qué pasó", "Agregue fotos y envíe"],
    name: "Su nombre",
    email: "Correo de PayPal",
    emailHint: "Enviamos la ayuda a este correo a través de PayPal, así que debe ser el correo de su cuenta de PayPal.",
    phone: "Teléfono",
    address: "Dirección de la vivienda dañada",
    zip: "Código postal",
    householdSize: "Personas en el hogar",
    requestedAmount: "Monto que solicita (USD)",
    narrative: "Con sus propias palabras",
    narrativeHint: "¿Qué se dañó? ¿Puede quedarse en su casa? ¿Qué es lo que más necesita?",
    requestedAmountHint: "El fondo fija cada ayuda según el nivel de daños y el tamaño de su hogar, así que esto solo nos ayuda a entender lo que necesita.",
    householdHint: "Los hogares de más de {n} personas reciben una ayuda mayor.",
    metaTitle: "Solicitar ayuda",
    photos: "Fotos de los daños",
    photosHint: "Hasta 3 fotos de los daños, como la marca del agua en una pared, pertenencias arruinadas o un aviso de evacuación. No hacen falta caras.",
    docs: "Documento",
    docsHint: "Si tiene uno, agregue un recibo, un contrato de alquiler o un aviso.",
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
    consent: "Al enviar, confirma que todo lo que escribió es verdad. Sus fotos y datos de contacto se mantienen privados, y en el registro público solo aparece un resumen anónimo de una línea.",
    consentDemo:
      "Esto es una demostración. Lo que escribió y sus fotos se pueden ver en la consola abierta del personal del fondo. Su nombre, correo, teléfono y dirección se mantienen ocultos allí, y en el registro público solo aparece un resumen anónimo de una línea.",
    demoNotice:
      "Sitio de demostración: use un nombre y una historia inventados, y no envíe fotos de personas reales. Lo que escriba y las fotos que agregue se pueden ver en la consola abierta del personal del fondo. Su nombre, correo, teléfono y dirección se mantienen ocultos.",
    errors: {
      required: "Este campo es obligatorio.",
      household: "Indique cuántas personas viven en su hogar.",
      email: "Ingrese un correo válido.",
      zip: "Ingrese un código postal de 5 dígitos.",
      photos: "Agregue al menos una foto.",
      tooLarge: "Cada archivo debe pesar menos de 10 MB.",
      fileType: "No pudimos leer {name}. Envíelo como foto JPEG o PNG. Las fotos HEIC del iPhone todavía no son compatibles.",
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
    batch: "Referencia de PayPal",
    replyTitle: "Responda las preguntas de arriba",
    replyText: "Sus respuestas",
    replyPhotos: "Nuevas fotos o documentos",
    replySubmit: "Enviar mis respuestas",
    replySent: "Gracias, su caso vuelve a revisión.",
    notFound: "No encontramos una solicitud para este enlace.",
    keepLink: "Guarde este enlace. Es la única forma de volver a su caso, ya que no hay cuenta ni contraseña.",
    metaTitle: "Su solicitud",
    paidTitle: "Ya tiene {amount} en su cuenta de PayPal.",
    paidHint: "Llegó {duration} después de su solicitud. Esperamos que le ayude a salir adelante.",
    steps: {
      new: "Solicitud recibida",
      evaluating: "Revisada",
      approved: "Aprobada",
      paying: "Enviada por PayPal",
      paid: "En su cuenta de PayPal",
    },
    stepNow: {
      new: "En la fila para revisión",
      evaluating: "En revisión ahora",
      needs_info: "Esperando su respuesta",
      needs_review: "Con un voluntario",
      approved: "Preparando su pago",
      parked: "Esperando donaciones",
      paying: "PayPal lo está enviando",
    },
  },
};

export const MESSAGES: Record<Lang, Strings> = { en, es };

/** Statuses in the order shown on the applicant's timeline. */
export const TIMELINE = ["new", "evaluating", "approved", "paying", "paid"] as const satisfies readonly CaseStatus[];
