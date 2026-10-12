/** An expected failure whose message is safe to show the user. */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "forbidden"
      | "not_found"
      | "conflict"
      | "invalid"
      | "locked"
      | "setup_done" = "invalid",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = "Only adults can do that.") {
    super(message, "forbidden");
  }
}
