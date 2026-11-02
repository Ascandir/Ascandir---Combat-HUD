# Ascandir - Combat HUD

Ein eigenes Kampf-HUD für Foundry VTT (v14, dnd5e 6.x) im rustikalen Fantasy-Look. Der Aufbau orientiert sich am bekannten Argon-HUD. Das Modul ist aber komplett eigenständig und braucht Argon nicht.

Mit Anbindung an **Ascandir - DnD5e Mounting**: Sitzt ein Charakter auf, zeigt das HUD die Werte des Reittiers und einen eigenen Bereich **Reittier** mit dessen Aktionen.

## Installation

In Foundry unter **Add-on Modules → Install Module** diese Manifest-URL eintragen:

```
https://github.com/Ascandir/Ascandir---Combat-HUD/releases/latest/download/module.json
```

Falls Argon noch aktiv ist, solltest du es deaktivieren, sonst liegen zwei HUDs übereinander.

## Öffnen

- Links in der Token-Leiste auf den **Schild** klicken. Oder unter **Steuerung konfigurieren** eine Taste für „Kampf-HUD ein-/ausblenden“ festlegen.
- Bei Kampfbeginn und wenn dein Charakter am Zug ist, öffnet es sich automatisch. Das lässt sich in den Einstellungen abschalten.
- Optional öffnet es sich schon beim Auswählen eines Tokens.

## Aufbau

**Portrait (links)**
- Bild, Name, Stufe/Klasse bzw. HG/Kreaturtyp sowie TP (inkl. temporärer), RK und Zauber-SG.
- Aktive Effekte erscheinen als kleine Symbole am Rand.
- Bei 0 TP erscheinen die Todesrettungswürfe. Ein Klick auf den Totenkopf würfelt.
- Ein Klick aufs Bild öffnet den Charakterbogen.
- Darüber liegt die Leiste **Rettungswürfe / Fertigkeiten / Werkzeuge**. Ein Klick klappt die Liste auf, und ein Klick auf einen Wert würfelt.

**Bewegung**: Zeigt die verbleibende Bewegung im aktuellen Zug als Felder. Mit „Spurten“ kommen orangefarbene Felder dazu.

**Bereiche**: Aktion · Bonusaktion · *Reittier* · Reaktion · Spezial (bei NSCs zusätzlich Legendär/Hort/Mythisch)
- **Waffe** aus dem aktiven Waffenset (Haupthand in Aktion, Nebenhand in Bonusaktion, Nahkampfwaffe als Gelegenheitsangriff in Reaktion).
- **Zauber wirken**: nach Grad sortiert, mit Zauberplätzen als Rauten.
- **Merkmal nutzen** / **Gegenstand nutzen** / **Waffen**.
- Merkmale mit Ladungen (z. B. Kanalisieren) liegen als kleine Kacheln direkt im Bereich.
- **Standardaktionen**: Spurten, Rückzug, Ausweichen, Helfen, Verstecken, Vorbereiten, Suchen, Untersuchen, Beeinflussen, Benutzen.
- Linksklick nutzt die Aktion, Rechtsklick öffnet den Gegenstand. Mit gedrückter Umschalttaste bleibt das Ausklapp-Fenster offen.
- Im Kampf wird ein Bereich nach der Nutzung ausgegraut, bis du wieder dran bist. Ein Klick auf das Banner setzt ihn von Hand zurück.
- Beim Überfahren erscheint ein Pergament-Tooltip. Die Reichweite wird als Ring um den Token angezeigt.

**Waffensets I–III** (zwischen Portrait und Würfe-Leiste): Waffe aus dem Charakterbogen auf ein Feld ziehen, Rechtsklick leert es. Beim Wechsel wird automatisch an- bzw. abgelegt.

**Knöpfe über der Bewegung**: Charakterbogen, Initiative würfeln (zeigt danach den Wert), Kurze und Lange Rast (außerhalb des Kampfes).

**Zug beenden** erscheint am Ende der Leiste, wenn du dran bist. Mit dem kleinen Pfeil lässt sich das HUD einklappen.

## Einstellungen

**Für jeden Spieler** (Moduleinstellungen, „Client“):
- Design, automatische Skalierung, Größe, Tooltip-Größe
- Portrait rechts (alles gespiegelt), frei verschieben (Griff zum Ziehen, Position wird gespeichert), Abstand zum Rand/unten
- Beim Auswählen öffnen, im Kampf automatisch öffnen, Makroleiste/Spielerliste ausblenden
- Ausblenden, wenn ungenutzt (Wartezeit und Deckkraft einstellbar)
- Tooltips, Reichweitenring
- Standardaktionen, Merkmale mit Ladungen direkt im Bereich, paarweise stapeln, leere Bereiche zeigen, Makro-Bereich

**Für die Spielleitung** („Welt“):
- Aktivitäten einzeln anzeigen (nie / nur Waffen / immer)
- Nur vorbereitete Zauber, Waffensets ausrüsten
- Bewegung zählen, Aktionen als verbraucht markieren
- Reittier-Bereich anzeigen

## Reittier (mit „Ascandir - DnD5e Mounting“)

Sobald dein Charakter aufgesessen ist:
- Das Portrait zeigt das Bild des kombinierten Tokens. Die Infos des Reiters rutschen nach oben, darunter stehen Name, TP, RK und Bewegungsrate des Reittiers.
- Nach der Bonusaktion erscheint der Bereich **Reittier** mit den Angriffen, Merkmalen und Zaubern des Reittiers sowie den Reittier-Aktionen Spurten, Rückzug und Ausweichen. Würfe laufen auf das Reittier.
- In der Würfe-Liste kann man zwischen Reiter und Reittier umschalten.
- Der Knopf **Absitzen** im Reittier-Bereich lässt dich absteigen.
- Gehört dir das Reittier nicht, ist der Bereich gesperrt (Schloss-Symbol). Der SL muss dir Besitzrechte am Reittier-Akteur geben.

## Designs

Eingebaut: **Rustikal (Holz & Bronze)** und **Gotik & Pergament**. Die Auswahl findest du in den Moduleinstellungen.

Andere Module (z. B. der Themer) können eigene Designs anmelden:

```js
Hooks.once("ascandir-combat-hud.registerThemes", (api) => {
  api.registerTheme({
    id: "mein-design",
    label: "Mein Design",
    vars: { "--ach-frame": "#c9a24a", "--ach-wood": "#1a1410" },
    css: ".ach-theme-mein-design .ach-panel-label { border-radius: 8px; }"
  });
});
```

Wichtige Variablen: `--ach-wood`, `--ach-wood-2`, `--ach-wood-hi` (Holz), `--ach-frame`, `--ach-frame-hi`, `--ach-frame-dark` (Rahmen), `--ach-parchment`, `--ach-parchment-2`, `--ach-ink` (Pergament), `--ach-text`, `--ach-text-dim`, `--ach-banner`, `--ach-banner-text`, `--ach-c-action`, `--ach-c-bonus`, `--ach-c-mount`, `--ach-c-reaction`, `--ach-c-special`, `--ach-hp`, `--ach-move`, `--ach-move-dash`, `--ach-tile` (Kachelgröße), `--ach-font-head`, `--ach-font-body`, `--ach-bg-panel`, `--ach-bg-paper` (komplette Hintergründe, auch Bilder per `url(...)`).
