export interface GlinkSandboxTestHotel {
  city: string;
  hotelId: number;
}

// Source: FCG Developer Platform → G-Link → Hotel Test Data.
// Retrieved 2026-07-30. The portal contains one duplicate (10232185);
// this normalized list intentionally contains unique hotel IDs only.
const hotelsByCity: Record<string, number[]> = {
  "Hong Kong": [
    150739, 542355, 607140, 10212363, 10232142, 10232185, 10232188,
    10583770, 10583771,
  ],
  Shenzhen: [
    110316, 110317, 110318, 110319, 131648, 169960, 607042, 607043,
    169963, 607222,
  ],
  Shanghai: [
    112291, 112865, 112950, 123001, 197620, 605800, 605803, 606361,
    606362, 606680,
  ],
  Beijing: [
    112261, 137316, 10625416, 606360, 606364, 606367, 10625410,
    10212345, 10212411,
  ],
  Guangzhou: [
    606902, 607285, 607388, 10232234, 10582004, 10583769, 10593805,
    10593808,
  ],
  Singapore: [
    10251105, 10233794, 10234888, 10235300, 10236496, 10243220,
    10243351, 10246672, 10249226, 10250950,
  ],
  "Kuala Lumpur": [
    10059869, 10062503, 10095332, 10095789, 10105225, 10074642,
    10075895, 10075896, 10076586, 10079881, 10082988,
  ],
  London: [
    10232671, 10232756, 10232774, 10232829, 10233815, 10233874,
    10233936, 10234117, 10236536, 10236085,
  ],
  "Ho Chi Minh City": [
    10232270, 10232425, 10232558, 10233035, 10233351, 10233614,
    10233938, 10235591, 10235647, 10235768, 10236655, 10237044,
  ],
  Seoul: [
    10232603, 10234143, 10234441, 10241049, 10242741, 10242852,
    10243929, 10245914, 10248676, 10248956, 10249868, 10253234,
    10255383,
  ],
  Tokyo: [
    10052856, 10053879, 10057093, 10068926, 10087697, 10102780,
    10105891, 10115130, 10135504, 10164703, 10201627, 10233091,
    10233294, 10233942, 10234489, 10235214,
  ],
  Jakarta: [
    10049969, 10073655, 10075951, 10080966, 10081441, 10085005,
    10087801, 10092544, 10101058, 10104103, 10106963, 10111207,
    10111212, 10117490,
  ],
  "New York": [
    10060597, 10060648, 10060868, 10061107, 10061259, 10061322,
    10061368, 10061730, 10062000, 10062392, 10063506, 10064013,
  ],
  Bangkok: [10037273, 10038630, 10038777, 10038989],
};

export const GLINK_SANDBOX_TEST_HOTELS: GlinkSandboxTestHotel[] =
  Object.entries(hotelsByCity).flatMap(([city, hotelIds]) =>
    hotelIds.map(hotelId => ({ city, hotelId })));

export const GLINK_SANDBOX_TEST_DESTINATIONS = Object.keys(hotelsByCity);

export function assertSandboxTestDataAllowed(mode: string, environment: string) {
  if (mode !== "sandbox" || environment !== "sandbox") {
    throw new Error("G-Link official test hotels are restricted to the sandbox environment");
  }
}
