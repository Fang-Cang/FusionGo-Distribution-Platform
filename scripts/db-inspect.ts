import "dotenv/config";
import { openFusionDatabase } from "../server/database.js";

const database = openFusionDatabase();
try {
  const status = database.status();
  const profile = database.getAccountProfile();
  const travelers = database.listAccountTravelers();
  const notifications = database.getNotificationPreferences();
  console.log(JSON.stringify({
    status,
    account: {
      profile: {
        id: profile.id,
        name: profile.name,
        language: profile.language,
        phone: profile.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2"),
        email: profile.email.replace(/^(.{1,2}).*(@.*)$/, "$1***$2"),
        hasAvatar: Boolean(profile.avatarMime),
        updatedAt: profile.updatedAt,
      },
      travelers,
      notifications,
    },
  }, null, 2));
} finally {
  database.close();
}
