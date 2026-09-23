import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import * as bcrypt from 'bcrypt';

export type UserDocument = HydratedDocument<User>;

/**
 * Strip every secret from a serialized user.
 *
 * Shared by toJSON and toObject so the two can never drift apart — if only one
 * of them deleted `password`, any code path using the other would leak it.
 */
function stripSecrets(_doc: unknown, ret: Record<string, any>) {
  delete ret.password;
  delete ret.hashedRefreshToken;
  delete ret.refreshSessions;
  delete ret.__v;
  return ret;
}

/**
 * A signed-in device. `hash` is the SHA-256 of that device's current refresh
 * token; `prevHash` is the one it replaced, kept briefly so a request that was
 * already in flight when the token rotated is not mistaken for theft.
 */
@Schema({ _id: false })
export class RefreshSession {
  @Prop({ required: true })
  sid: string;

  @Prop({ required: true })
  hash: string;

  @Prop()
  prevHash?: string;

  @Prop()
  rotatedAt?: Date;

  @Prop({ required: true })
  expiresAt: Date;
}

export const RefreshSessionSchema = SchemaFactory.createForClass(RefreshSession);

@Schema({
  timestamps: true,
  toJSON: { virtuals: true, transform: stripSecrets },
  toObject: { virtuals: true, transform: stripSecrets },
})
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /**
   * `select: false` keeps the hash out of every query that does not explicitly
   * ask for it. Previously the field was selected by default and only removed
   * during JSON serialization, so any code reading `user.password` — or
   * logging a raw document — saw the hash.
   */
  @Prop({ required: true, select: false })
  password: string;

  /**
   * The bcrypt hash of the current refresh token.
   *
   * This field previously had no `@Prop()` decorator, so Mongoose's strict mode
   * silently discarded it on every save. `bcrypt.compare` in the refresh flow
   * was therefore always comparing against `undefined`, which meant token
   * refresh could never succeed and users were logged out when their 15-minute
   * access token expired. It also needs `select: false` for the same reason as
   * `password`.
   */
  @Prop({ required: false, select: false })
  hashedRefreshToken?: string;

  /**
   * One entry per signed-in device. Replaces `hashedRefreshToken`, which held
   * a single session, so signing in on a phone signed the laptop out. It is
   * cleared on the next sign-in; tokens minted against it are not accepted.
   */
  @Prop({ type: [RefreshSessionSchema], select: false, default: undefined })
  refreshSessions?: RefreshSession[];

  @Prop({ required: false })
  picture?: string;

  @Prop({ required: false })
  firstName?: string;

  @Prop({ required: false })
  lastName?: string;

  @Prop({ required: false })
  phone?: string;

  @Prop({ required: false })
  company?: string;

  /** Job title. */
  @Prop({ required: false })
  designation?: string;

  @Prop({ required: false, maxlength: 300 })
  bio?: string;

  /**
   * Set for accounts created through Google OAuth. Those accounts get a random
   * password they can never know, so password login must be refused for them
   * rather than failing with a confusing "wrong password".
   */
  // `type: String` is explicit because the `string | null` union gives Mongoose
  // no single type to infer, and it throws at schema-build time without it.
  @Prop({ type: String, required: false, default: null })
  provider?: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre<UserDocument>('save', async function (next) {
  // Only re-hash when the plaintext actually changed, otherwise every save
  // would hash the existing hash again and invalidate the password.
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
