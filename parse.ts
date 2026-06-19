import * as fs from 'fs';
const html = fs.readFileSync('./tmp.html', 'utf8');

const ids = ['Flyweight', 'Bantamweight', 'Featherweight', 'Lightweight', 'Welterweight', 'Middleweight', 'Light_Heavyweight', 'Heavyweight', 'Men\'s_pound-for-pound'];

for(const id of ids) {
    let titleIdx = html.indexOf('id="' + id + '"');
    if(titleIdx === -1) titleIdx = html.indexOf('id="' + id.replace('_', ' ') + '"');
    
    if(titleIdx !== -1) {
       const section = html.slice(titleIdx);
       const table = section.slice(section.indexOf('<table'), section.indexOf('</table>'));
       const rows = table.split('<tr');
       console.log('\n==== ' + id + ' ====');
       for(let i=1; i<Math.min(18, rows.length); i++) {
         const cells = rows[i].split(/<(td|th)[^>]*>/);
         if(cells.length > 2) {
             const text = cells.slice(1).join('').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\[\d+\]/g, '').replace(/&#160;/g, '').trim();
             console.log(text);
         }
       }
    }
}
