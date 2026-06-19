import * as fs from 'fs';

const parsed = fs.readFileSync('parsed.txt', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');

// Match all name and flag
const flagsMatch = [...indexHtml.matchAll(/name\s*:\s*['"]([^'"]+)['"]\s*,\s*flag\s*:\s*['"]([^'"]+)['"]/g)];
const flagsMap = {};
for(const m of flagsMatch) {
  flagsMap[m[1].toLowerCase()] = m[2];
}

const metadata = {
  Flyweight: { id: 'flyweight', icon: '⚡', label: 'FLYWEIGHT', limit: '125 lb / 56.7 kg' },
  Bantamweight: { id: 'bantamweight', icon: '🥊', label: 'BANTAMWEIGHT', limit: '135 lb / 61.2 kg' },
  Featherweight: { id: 'featherweight', icon: '🦅', label: 'FEATHERWEIGHT', limit: '145 lb / 65.8 kg' },
  Lightweight: { id: 'lightweight', icon: '💨', label: 'LIGHTWEIGHT', limit: '155 lb / 70.3 kg' },
  Welterweight: { id: 'welterweight', icon: '💪', label: 'WELTERWEIGHT', limit: '170 lb / 77.1 kg' },
  Middleweight: { id: 'middleweight', icon: '🔥', label: 'MIDDLEWEIGHT', limit: '185 lb / 83.9 kg' },
  Light_Heavyweight: { id: 'lightheavyweight', icon: '🦁', label: 'LIGHT HEAVYWEIGHT', limit: '205 lb / 92.9 kg' },
  Heavyweight: { id: 'heavyweight', icon: '🏔️', label: 'HEAVYWEIGHT', limit: '265 lb / 120.2 kg' }
};

let output = 'const WEIGHT_CLASSES = [\n';
const blocks = parsed.split('====').map(b => b.trim()).filter(b => b.length > 0);

for (let i = 0; i < blocks.length; i += 2) {
   const divName = blocks[i];
   if (!metadata[divName]) continue;
   
   const meta = metadata[divName];
   const content = blocks[i+1].split('\n').filter(l => l.startsWith('th C') || l.startsWith('th IC') || l.match(/^th\d/));
   
   output += `  {\n    id: '${meta.id}', icon: '${meta.icon}',\n    label: '${meta.label}', limit: '${meta.limit}',\n`;
   
   let champLine = content.find(l => l.startsWith('th C'));
   if (champLine) {
     const cols = champLine.split(' td ');
     let realName = cols[2].trim();
     let record = cols[3].trim().replace(/&#160;/g, '').replace(/ /g, '');
     let flag = flagsMap[realName.toLowerCase()] || '🏳️';
     output += `    champ: { name:'${realName.replace(/'/g, "\\'")}', flag:'${flag}', record:'${record}' },\n`;
   } else {
     output += `    champ: { name:'TBD', flag:'', record:'' },\n`;
   }
   
   output += `    fighters: [\n`;
   for (let l of content) {
     if (l.startsWith('th C') || l.startsWith('th IC')) continue;
     const cols = l.split(' td ');
     let rank = l.match(/^th(\d+)/)?.[1] || '0';
     let realName = cols[2].trim();
     let record = cols[3].trim().replace(/&#160;/g, '').replace(/ /g, '');
     let flag = flagsMap[realName.toLowerCase()] || '🏳️';
     output += `      { rank:${rank}, name:'${realName.replace(/'/g, "\\'")}', flag:'${flag}', record:'${record}' },\n`;
   }
   output += `    ]\n  },\n`;
}

output += '];\n';
fs.writeFileSync('new_divisions.js', output);
console.log("Done");
