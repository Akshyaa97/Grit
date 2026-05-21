// Show the UI
figma.showUI(__html__, { width: 400, height: 500 });

async function findFonts() {
  try {
    // Notify UI that scan has started
    figma.ui.postMessage({ type: 'scan-started' });

    // Use figma.root.findAll to scan the entire document
    const textNodes = figma.root.findAll(node => node.type === "TEXT") as TextNode[];

    // Get available fonts once to optimize
    const availableFonts = await figma.listAvailableFontsAsync();
    const availableFontsSet = new Set(availableFonts.map(f => `${f.fontName.family}-${f.fontName.style}`));

    const fontsMap = new Map<string, { family: string, style: string, isMissing: boolean, count: number }>();

    // Process in batches to avoid blocking the main thread if there are many nodes
    const batchSize = 100;
    for (let i = 0; i < textNodes.length; i += batchSize) {
      const batch = textNodes.slice(i, i + batchSize);

      for (const node of batch) {
        // getRangeAllFontNames returns an array of FontName objects used in the node
        const fonts = node.getRangeAllFontNames(0, node.characters.length);

        for (const font of fonts) {
          const key = `${font.family}-${font.style}`;
          const isMissing = !availableFontsSet.has(key);

          if (fontsMap.has(key)) {
            fontsMap.get(key)!.count++;
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

      // Yield control back to Figma to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const result = Array.from(fontsMap.values());
    figma.ui.postMessage({ type: 'fonts-detected', fonts: result });

  } catch (error) {
    console.error('Error scanning fonts:', error);
    figma.ui.postMessage({
      type: 'error',
      message: 'An error occurred while scanning the document. It might be too large or complex.'
    });
  }
}

// Listen for messages from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'scan-fonts') {
    await findFonts();
  }
};

// Initial scan
findFonts();
