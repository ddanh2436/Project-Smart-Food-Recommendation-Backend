import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

interface RequestWithUser extends Request {
  user: { sub: string; email: string };
}

/**
 * Every route here requires a valid access token.
 *
 * This controller previously had no guards at all, so anyone on the internet
 * could `GET /users` to dump the whole user list, or `PATCH`/`DELETE /users/:id`
 * to modify or delete any account. The public `POST /users` route is also gone —
 * account creation belongs to `POST /auth/register`, which hashes the password
 * and issues tokens; the duplicate here accepted an arbitrary body.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** The caller's own record. */
  @Get('me')
  findMe(@Req() req: RequestWithUser) {
    return this.usersService.findOne(req.user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    this.assertSelf(id, req);
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: RequestWithUser,
  ) {
    this.assertSelf(id, req);
    return this.usersService.updateProfileFields(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    this.assertSelf(id, req);
    return this.usersService.remove(id);
  }

  /**
   * Authentication alone is not enough here: without this check any logged-in
   * user could read or delete any other user by guessing an id.
   */
  private assertSelf(id: string, req: RequestWithUser): void {
    if (id !== req.user.sub) {
      throw new ForbiddenException('You can only access your own account');
    }
  }
}
