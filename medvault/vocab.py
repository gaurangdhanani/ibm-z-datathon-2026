"""ORG-1 content: the organizer's vocabulary and the note templates behind the synthetic set.

Pure data, no code: the content lead edits this file. Keywords are lower-case stems matched on
word boundaries (``organizer.tag_text``); ``sensitivity`` is the level a hit implies (3 = the
access rules freeze clerks, 2 = personal, 1 = routine). Templates feed ``organizer_eval``
(DATA-1): ``{doctor}`` and ``{date}`` are filled in; every other field is the ground truth.
"""

from __future__ import annotations

# label -> (specialty shown as the condition, keywords)
BODY_PARTS: dict[str, tuple[str, list[str]]] = {
    "Knee": ("Orthopedics", ["knee", "acl", "pcl", "menisc", "patella", "meniscectomy"]),
    "Shoulder": ("Orthopedics", ["shoulder", "rotator cuff", "labrum", "scapul"]),
    "Hip": ("Orthopedics", ["hip", "femoral", "acetabul"]),
    "Spine": ("Orthopedics", ["spine", "spinal", "lumbar", "cervical disc", "sciatica", "back pain", "vertebra"]),
    "Hand": ("Orthopedics", ["wrist", "carpal", "hand fracture", "finger"]),
    "Heart": ("Cardiology", ["heart", "cardiac", "cardio", "echo", "ecg", "ekg", "mitral", "lvef", "angina", "stent", "atrial"]),
    "Lungs": ("Pulmonology", ["lung", "lungs", "asthma", "chest x-ray", "pulmon", "copd", "inhaler", "spirometry"]),
    "Skin": ("Dermatology", ["skin", "rash", "derma", "eczema", "mole", "psoriasis", "acne"]),
    "Eyes": ("Ophthalmology", ["eye", "eyes", "retina", "cataract", "vision", "glaucoma", "ophthalm"]),
    "Stomach": ("Gastroenterology", ["stomach", "abdom", "gastr", "colonoscopy", "reflux", "gerd", "bowel", "endoscopy", "liver"]),
    "Kidneys": ("Nephrology", ["kidney", "renal", "nephro", "dialysis", "creatinine clearance"]),
    "Brain": ("Neurology", ["brain", "migraine", "seizure", "neurolog", "headache", "concussion", "epilep", "stroke"]),
    "Thyroid": ("Endocrinology", ["thyroid", "tsh", "levothyroxine", "goiter", "goitre"]),
    "Teeth": ("Dental", ["tooth", "teeth", "dental", "molar", "cavity", "root canal"]),
    "Ears": ("ENT", ["ear", "ears", "hearing", "tinnitus", "sinus", "tonsil", "otitis"]),
}  # fmt: skip

# label -> (sensitivity, keywords) for conditions that have no single body part
CONDITIONS: dict[str, tuple[int, list[str]]] = {
    "Psychiatry": (3, ["psychiatr", "psychiatry", "anxiety", "depress", "therapy session", "sertraline", "fluoxetine", "escitalopram", "ptsd", "bipolar", "panic attack", "phq-9", "gad-7", "counsel", "suicid", "mental health"]),
    "Sexual health": (3, ["hiv", "sti", "std", "chlamydia", "gonorrh", "syphilis", "prep", "herpes", "sexual health"]),
    "Genetics": (3, ["brca", "genetic", "genome", "carrier screen", "hereditary", "chromosom"]),
    "Substance use": (3, ["substance use", "alcohol use", "opioid", "naloxone", "detox", "addiction", "rehab", "withdrawal"]),
    "Reproductive health": (3, ["pregnan", "prenatal", "obstetric", "contracept", "ivf", "miscarriage", "fertility", "trimester"]),
    "Oncology": (2, ["oncolog", "chemotherapy", "tumor", "tumour", "biopsy", "malignan", "carcinoma", "lymphoma", "radiotherapy"]),
    "Endocrinology": (1, ["hba1c", "diabet", "insulin", "metformin", "glucose"]),
    "Allergy": (1, ["allerg", "anaphyla", "antihistamine", "skin prick", "epipen"]),
    "Infectious disease": (1, ["covid", "influenza", "infection", "antibiotic", "sepsis", "pneumonia", "strep", "tetanus", "diphtheria", "vaccin", "booster", "immuni"]),
    "General health": (1, ["annual physical", "wellness", "check-up", "checkup", "vitals", "metabolic panel", "cholesterol", "lipid"]),
}  # fmt: skip

# label -> keywords. Labels map to Record.category through organizer.CATEGORY_OF.
RECORD_TYPES: dict[str, list[str]] = {
    "Imaging": ["mri", "x-ray", "xray", "ct scan", "ct", "ultrasound", "imaging", "radiograph", "scan", "echocardiogram", "mammogram", "colonoscopy", "endoscopy"],
    "Lab result": ["blood test", "panel", "lab", "cbc", "serum", "mmol/l", "mg/dl", "u/l", "miu/l", "culture", "titer", "result", "results", "function test", "screen", "antibody", "serology", "sequencing", "egfr", "biopsy result"],
    "Prescription": ["prescription", "rx", "tablet", "refill", "capsule", "mg daily", "by mouth", "dispense"],
    "Discharge summary": ["discharge", "discharged", "day-case", "admitted", "hospital stay"],
    "Vaccination": ["vaccin", "tetanus", "immuni", "booster", "dose administered"],
    "Visit note": ["follow-up", "visit", "consult", "assessment", "plan:", "history of present", "examination", "review in"],
    "Referral": ["referral", "referred to", "second opinion"],
}  # fmt: skip

DOCTORS = [
    "Dr. Elena Vasquez", "Dr. Amir Haddad", "Dr. Lina Park", "Dr. Marcus Reed", "Dr. Sofia Alvarez",
    "Dr. Tomás Ibarra", "Dr. Grace Whitfield", "Dr. Noah Bennett", "Dr. Priya Nair", "Dr. Omar Siddiqui",
]  # fmt: skip

# (title, record type, body part, condition, sensitivity, text). The second sentence of several
# templates mentions another body part or specialty on purpose: the tagger has to weigh hits,
# not just find one. ``{doctor}`` and ``{date}`` are filled by organizer_eval.generate.
NOTE_TEMPLATES: list[tuple[str, str, str | None, str, int, str]] = [
    ("Knee MRI report", "Imaging", "Knee", "Orthopedics", 1,
     "MRI right knee without contrast, {date}. Findings: complex tear of the posterior horn of the medial meniscus with moderate joint effusion. ACL and PCL intact. Read by {doctor}."),
    ("Knee arthroscopy discharge", "Discharge summary", "Knee", "Orthopedics", 1,
     "Discharge summary {date}. Day-case arthroscopic partial medial meniscectomy, right knee, no complications. Discharged with crutches and a physiotherapy referral. Surgeon: {doctor}."),
    ("Shoulder physio plan", "Visit note", "Shoulder", "Orthopedics", 1,
     "Visit {date} with {doctor}. Rotator cuff strain, left shoulder. Six-week programme: scapular stabilisation and band work. Mild knee stiffness noted but not treated."),
    ("Lumbar spine X-ray", "Imaging", "Spine", "Orthopedics", 1,
     "Lumbar spine X-ray, {date}. Mild degenerative disc narrowing at L4-L5, no fracture. Correlate with sciatica symptoms. Reported by {doctor}."),
    ("Hip replacement follow-up", "Visit note", "Hip", "Orthopedics", 1,
     "Follow-up {date}, {doctor}. Six weeks after left hip arthroplasty. Wound healed, range of motion improving, continue physiotherapy. Review in 6 weeks."),
    ("Wrist fracture X-ray", "Imaging", "Hand", "Orthopedics", 1,
     "Radiograph of the right wrist {date}: healed distal radius fracture, cast removed. {doctor}."),
    ("Echocardiogram report", "Imaging", "Heart", "Cardiology", 1,
     "Transthoracic echocardiogram {date}. LVEF 58%, mild mitral regurgitation, no pericardial effusion. Cardiology reviewer: {doctor}."),
    ("Cardiology consult", "Visit note", "Heart", "Cardiology", 1,
     "Cardiology consult {date} with {doctor}. Exertional angina, ECG unremarkable at rest. Plan: stress test, start low-dose aspirin. Review in 4 weeks."),
    ("Lipid panel", "Lab result", None, "General health", 1,
     "Lipid panel {date}: total cholesterol 212 mg/dL, LDL 138 mg/dL, HDL 44 mg/dL, triglycerides 150 mg/dL. Ordered by {doctor}."),
    ("Comprehensive metabolic panel", "Lab result", None, "General health", 1,
     "Comprehensive metabolic panel {date}: sodium 139 mmol/L, potassium 4.1 mmol/L, glucose 92 mg/dL, creatinine 0.8 mg/dL, ALT 21 U/L. All values within reference range. {doctor}."),
    ("Asthma review", "Visit note", "Lungs", "Pulmonology", 1,
     "Asthma review {date}, {doctor}. Night-time wheeze twice a week, spirometry FEV1 82% predicted. Plan: step up inhaled steroid, review in 8 weeks."),
    ("Chest X-ray", "Imaging", "Lungs", "Pulmonology", 1,
     "Chest X-ray {date}: lungs clear, no consolidation or effusion, heart size normal. Reported by {doctor}."),
    ("Dermatology visit", "Visit note", "Skin", "Dermatology", 1,
     "Dermatology visit {date} with {doctor}. Itchy rash on both forearms consistent with eczema. Plan: emollient twice daily, mild topical steroid for one week."),
    ("Mole biopsy result", "Lab result", "Skin", "Dermatology", 2,
     "Skin biopsy result {date}: compound naevus, no malignant features. Reassured. Dermatology, {doctor}."),
    ("Eye exam", "Visit note", "Eyes", "Ophthalmology", 1,
     "Eye examination {date}, {doctor}. Vision 20/25 both eyes, intraocular pressure normal, early cataract left eye. Review in 12 months."),
    ("Colonoscopy report", "Imaging", "Stomach", "Gastroenterology", 1,
     "Colonoscopy {date} performed by {doctor}. Two small polyps removed from the sigmoid colon, otherwise normal bowel. Repeat scan in 5 years."),
    ("Reflux follow-up", "Visit note", "Stomach", "Gastroenterology", 1,
     "Follow-up {date} with {doctor} for reflux (GERD). Symptoms controlled on omeprazole 20 mg. Plan: continue, trial reduction in 3 months."),
    ("Kidney function panel", "Lab result", "Kidneys", "Nephrology", 1,
     "Renal panel {date}: creatinine 1.1 mg/dL, eGFR 71, urea 5.8 mmol/L. Kidney function stable. Nephrology review by {doctor}."),
    ("Migraine clinic note", "Visit note", "Brain", "Neurology", 1,
     "Neurology clinic {date}, {doctor}. Migraine without aura, four attacks a month. Plan: start propranolol, headache diary, review in 3 months."),
    ("Head CT after concussion", "Imaging", "Brain", "Neurology", 1,
     "CT scan of the head {date} after a concussion: no haemorrhage, no fracture. Reported by {doctor}."),
    ("Thyroid function test", "Lab result", "Thyroid", "Endocrinology", 1,
     "Thyroid function test {date}: TSH 6.2 mIU/L, free T4 low-normal. Suggest levothyroxine trial. Ordered by {doctor}."),
    ("Dental check-up", "Visit note", "Teeth", "Dental", 1,
     "Dental visit {date} with {doctor}. Small cavity in the lower left molar filled; gums healthy. Review in 6 months."),
    ("Ear infection visit", "Visit note", "Ears", "ENT", 1,
     "Visit {date}, {doctor}. Right ear pain and reduced hearing, otitis media. Plan: amoxicillin 5 days, review if not settled."),
    ("Psychiatry follow-up note", "Visit note", None, "Psychiatry", 3,
     "Psychiatry follow-up {date} with {doctor}. Generalised anxiety disorder, improved sleep on sertraline 50 mg. PHQ-9 score 6. Plan: continue current dose, review in 12 weeks."),
    ("Therapy session summary", "Visit note", None, "Psychiatry", 3,
     "Therapy session {date}. Depressive symptoms improving, GAD-7 down to 8. Continue weekly counselling. {doctor}. Also reports knee pain from running."),
    ("Prescription: sertraline 50 mg", "Prescription", None, "Psychiatry", 3,
     "Prescription {date} by {doctor}. Sertraline 50 mg tablet, one daily by mouth, 90-day supply, 1 refill."),
    ("Sexual health screen", "Lab result", None, "Sexual health", 3,
     "Sexual health screen {date}: HIV antibody negative, chlamydia and gonorrhoea NAAT negative, syphilis serology negative. Ordered by {doctor}."),
    ("PrEP prescription", "Prescription", None, "Sexual health", 3,
     "Prescription {date}, {doctor}. PrEP (emtricitabine/tenofovir) one tablet daily, 90-day supply. Repeat HIV test in 3 months."),
    ("BRCA genetic test", "Lab result", None, "Genetics", 3,
     "Genetic test result {date}: BRCA1 and BRCA2 sequencing, no pathogenic variant detected. Hereditary risk counselling offered. {doctor}."),
    ("Substance use counselling note", "Visit note", None, "Substance use", 3,
     "Visit {date} with {doctor}. Alcohol use disorder, 6 weeks abstinent, attending peer support. Naloxone kit provided. Review in 4 weeks."),
    ("Prenatal visit", "Visit note", None, "Reproductive health", 3,
     "Prenatal visit {date}, {doctor}. 20 weeks pregnant, blood pressure 112/70, anatomy ultrasound normal. Review in 4 weeks."),
    ("Contraception prescription", "Prescription", None, "Reproductive health", 3,
     "Prescription {date} by {doctor}. Combined oral contraceptive, one tablet daily, 6-month supply."),
    ("Oncology consult", "Visit note", None, "Oncology", 2,
     "Oncology consult {date} with {doctor}. Stage I lymphoma, biopsy confirmed. Plan: 4 cycles of chemotherapy, repeat CT scan after cycle 2."),
    ("Diabetes review", "Visit note", None, "Endocrinology", 1,
     "Diabetes review {date}, {doctor}. HbA1c 7.1%, on metformin 1000 mg twice daily. Plan: continue, foot check normal, review in 6 months."),
    ("Allergy test results", "Lab result", None, "Allergy", 1,
     "Skin prick testing {date}: positive for dust mite and cat dander, negative for peanut and shellfish. Allergy clinic, {doctor}."),
    ("COVID vaccination record", "Vaccination", None, "Infectious disease", 1,
     "Vaccination record {date}: COVID-19 booster dose administered, left deltoid, no adverse reaction. Given by {doctor}."),
    ("Tetanus booster", "Vaccination", None, "Infectious disease", 1,
     "Tetanus and diphtheria booster administered {date}. Next due in 10 years. {doctor}."),
    ("Strep throat visit", "Visit note", None, "Infectious disease", 1,
     "Visit {date}, {doctor}. Sore throat, fever, rapid strep positive. Plan: penicillin 10 days, rest, fluids."),
    ("Annual physical", "Visit note", None, "General health", 1,
     "Annual physical {date} with {doctor}. Vitals normal, BMI 24, no concerns. Routine bloods ordered. Wellness advice given."),
    ("Orthopedic referral", "Referral", "Knee", "Orthopedics", 1,
     "Referral {date} from {doctor}: second opinion requested on a chronic right knee effusion. Please see attached MRI."),
]  # fmt: skip
