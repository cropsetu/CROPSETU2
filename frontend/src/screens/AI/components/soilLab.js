/**
 * soilLab — open the official Government of India "Locate Soil Testing
 * Laboratory" service. There is no public API for this, so we deep-link the
 * farmer to the authoritative locator (always up to date, zero data upkeep).
 */
import { Linking, Alert } from 'react-native';

// National Government Services Portal — locate soil testing laboratory.
export const SOIL_LAB_LOCATOR_URL =
  'https://services.india.gov.in/service/detail/locate-soil-testing-laboratory';

/**
 * Open the locator in the device browser.
 * @param {function} t i18n function (key, fallback)
 */
export async function openSoilLabFinder(t = (k, f) => f) {
  try {
    const ok = await Linking.canOpenURL(SOIL_LAB_LOCATOR_URL);
    if (!ok) throw new Error('cannot open');
    await Linking.openURL(SOIL_LAB_LOCATOR_URL);
  } catch {
    Alert.alert(
      t('soilHub.lab.cannotOpenTitle', 'Could not open the lab finder'),
      t(
        'soilHub.lab.cannotOpenBody',
        'Please visit your nearest Block Agriculture Office or Krishi Vigyan Kendra (KVK) to get your soil tested.',
      ),
    );
  }
}
