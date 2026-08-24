import type { HotelOffer } from "./types.js";

type HotelIdentity = Pick<HotelOffer, "id" | "hotelId" | "name" | "city">;

const normalizedIdentityText = (value: string | undefined) => (value || "")
  .normalize("NFKC")
  .trim()
  .toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, "");

export const isSameHotel = (left: HotelIdentity, right: HotelIdentity): boolean => {
  if (left.id === right.id) return true;
  const leftHotelId = left.hotelId === undefined || left.hotelId === null ? "" : String(left.hotelId).trim();
  const rightHotelId = right.hotelId === undefined || right.hotelId === null ? "" : String(right.hotelId).trim();
  if (leftHotelId && rightHotelId) return leftHotelId === rightHotelId;
  const leftName = normalizedIdentityText(left.name);
  const rightName = normalizedIdentityText(right.name);
  if (!leftName || leftName !== rightName) return false;
  const leftCity = normalizedIdentityText(left.city);
  const rightCity = normalizedIdentityText(right.city);
  return !leftCity || !rightCity || leftCity === rightCity;
};

export const findFavoriteHotel = <T extends HotelIdentity>(favorites: T[], hotel: HotelIdentity): T | undefined =>
  favorites.find(favorite => isSameHotel(favorite, hotel));
