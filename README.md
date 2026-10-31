# Observationslog

Et lille værktøj til at notere observationer med tidsstempel, mens man følger en
arbejdsgang. Statisk side – ingen backend, ingen login, ingen eksterne kald.
Alt gemmes i browserens IndexedDB.

## Filer

| Fil | Indhold |
| --- | --- |
| `index.html` | Sidens skelet og notefeltet |
| `styles.css` | Al styling, lys og mørk tilstand |
| `app.js` | Logik: sessioner, noter, tags, overblik, eksport/import |
| `theme.js` | Sætter valgt tema før siden tegnes (undgår blink) |
| `sw.js` | Service worker, så siden virker offline |
| `manifest.webmanifest`, `icon.svg` | Gør siden installerbar som app |

## Kør lokalt

Service worker kræver `http://localhost` eller `https://`, så start en lille server:

```bash
python -m http.server 8080
```

Åbn derefter http://localhost:8080.

## Hosting

Siden hostes med GitHub Pages fra `main` på https://obs.adiyasa.dk.
Filen `CNAME` angiver domænet, og DNS hos Simply har en CNAME-record
`obs` → `adiyasa-repo.github.io`. HTTPS er påkrævet, ellers virker offline-tilstanden ikke.

Der er intet at bygge. Opdateringer pushes til `main`, og browseren henter
den nye version næste gang siden åbnes med internet.

Bemærk: data hører til domænet. Flytter du siden til en ny adresse, så eksportér
en JSON-backup på den gamle og importér den på den nye.
