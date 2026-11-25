using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Floorplan.Api.Database;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Home> Homes => Set<Home>();
    public DbSet<HomeShare> HomeShares => Set<HomeShare>();
    public DbSet<StoredFile> Files => Set<StoredFile>();
    public DbSet<HomeVersion> HomeVersions => Set<HomeVersion>();

    /// <summary>
    /// All dates are stored in UTC, but SQLite gives them back without a kind, and JSON then has no
    /// "Z": browsers read that as local time. Mark them as UTC when reading.
    /// </summary>
    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<DateTime>().HaveConversion<UtcConverter>();
        c.Properties<DateTime?>().HaveConversion<NullableUtcConverter>();
    }

    sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v,
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    sealed class NullableUtcConverter() : ValueConverter<DateTime?, DateTime?>(
        v => v.HasValue && v.Value.Kind == DateTimeKind.Local ? v.Value.ToUniversalTime() : v,
        v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.Property(x => x.Id).HasMaxLength(255);
            e.Property(x => x.Name).HasMaxLength(255);
            e.Property(x => x.Email).HasMaxLength(320);
            e.HasIndex(x => x.Email);
        });

        b.Entity<Home>(e =>
        {
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.OwnerId);
        });

        b.Entity<HomeShare>(e =>
        {
            e.Property(x => x.Email).HasMaxLength(320);
            e.Property(x => x.Role).HasMaxLength(16);
            e.HasOne<Home>().WithMany().HasForeignKey(x => x.HomeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.HomeId, x.Email }).IsUnique();
            e.HasIndex(x => x.Email);
            e.HasIndex(x => x.UserId);
        });

        b.Entity<StoredFile>(e =>
        {
            e.ToTable("Files");
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.RoomId).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(255);
            e.Property(x => x.Mime).HasMaxLength(255);
            e.Property(x => x.Path).HasMaxLength(300);
            e.HasOne<Home>().WithMany().HasForeignKey(x => x.HomeId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.HomeId, x.RoomId });
        });

        b.Entity<HomeVersion>(e =>
        {
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(200);
            e.HasOne<Home>().WithMany().HasForeignKey(x => x.HomeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.HomeId, x.CreatedAt });
        });
    }
}
