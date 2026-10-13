export function textPdf(text='Reading is a conversation with a book. Keep your own questions beside the original.'){
  const stream=`BT /F1 14 Tf 50 720 Td (${text.replace(/[()\\]/g,'\\$&')}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(pdf);
}
