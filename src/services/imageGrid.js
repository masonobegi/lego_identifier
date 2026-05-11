import * as ImageManipulator from 'expo-image-manipulator';

// Splits an image into rows x cols crops, returns array of URIs
export async function splitImageIntoGrid(imageUri, rows, cols) {
  // First get image dimensions by loading it at its natural size
  const info = await ImageManipulator.manipulateAsync(imageUri, [], {
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const fullW = info.width;
  const fullH = info.height;
  const cellW = Math.floor(fullW / cols);
  const cellH = Math.floor(fullH / rows);

  const crops = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const originX = c * cellW;
      const originY = r * cellH;
      // Clamp to image bounds
      const width = Math.min(cellW, fullW - originX);
      const height = Math.min(cellH, fullH - originY);

      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ crop: { originX, originY, width, height } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      crops.push({ uri: result.uri, row: r, col: c });
    }
  }

  return crops;
}
