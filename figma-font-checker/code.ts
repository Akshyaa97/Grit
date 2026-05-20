// Show the UI
figma.showUI(__html__, { width: 400, height: 500 });

async function findFonts() {
  // Use figma.root.findAll to scan the entire document
  const textNodes = figma.root.findAll(node => node.type === "TEXT") as TextNode[];

  // Get available fonts once to optimize
  const availableFonts = await figma.listAvailableFontsAsync();
  const availableFontsSet = new Set(availableFonts.map(f => `${f.fontName.family}-${f.fontName.style}`));

  const fontsMap = new Map<string, { family: string, style: string, isMissing: boolean, count: number }>();

  for (const node of textNodes) {
    // getRangeAllFontNames returns an array of FontName objects used in the node
    const fonts = node.getRangeAllFontNames(0, node.characters.length);

    for (const font of fonts) {
      const key = `${font.family}-${font.style}`;
      const isMissing = !availableFontsSet.has(key);

      if (fontsMap.has(key)) {
        fontsMap.get(key)!.count++;
        // If it was already marked missing or is now found missing, keep it missing
        if (isMissing) {
          fontsMap.get(key)!.isMissing = true;
        }
      } else {
        fontsMap.set(key, {
          family: font.family,
          style: font.style,
          isMissing: isMissing,
          count: 1
        });
      }
    }
  }

  const result = Array.from(fontsMap.values());

  figma.ui.postMessage({ type: 'fonts-detected', fonts: result });
}

// Listen for messages from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'scan-fonts') {
    await findFonts();
  }
};

// Initial scan
findFonts();
