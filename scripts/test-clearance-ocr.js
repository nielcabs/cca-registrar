const { parseClearanceOcrFields, runClearanceOcr } = require("../src/ocr");

const sample = `
CITY COLLEGE OF ANGELES
STUDENT'S CLEARANCE (UNDERGRADUATES)
Name: Sochuca, Justin Valde C.
Student No.: 20-3023
Course: BSIT
Academic Year: 2023 - 2024
1. Library
2. MISSO Office
3. Community Extension Office
4. Guidance and Admission Office
5. Office of Student Affairs
6. Office of the Dean
7. Finance Office
8. Office of the Registrar
`;

console.log("Parser test:", JSON.stringify(parseClearanceOcrFields(sample), null, 2));

const imagePath = process.argv[2];
if (imagePath) {
  runClearanceOcr(imagePath)
    .then((result) => {
      console.log("Image OCR confidence:", result.confidence);
      console.log("Extracted:", JSON.stringify(result.extracted, null, 2));
    })
    .catch((err) => console.error(err));
}
